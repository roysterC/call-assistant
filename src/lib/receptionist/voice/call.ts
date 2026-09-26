/**
 * One spoken conversation: turn-taking between a caller and the receptionist.
 *
 * Owns the decisions a phone line needs and a typed chat does not:
 *
 * - When has the caller finished? The recogniser says when they paused; their
 *   words since the last reply are sent as one turn.
 * - When to start speaking? At the first complete sentence of the reply, not
 *   the end of it, so the silence is the model's time to its first sentence.
 * - What if they talk over it? The reply stops, queued audio is dropped, the
 *   listener is told to throw away what it has buffered, and what they said
 *   becomes the next turn.
 * - What fills the gap while the diary is read? A few words, if the model has
 *   not already said some.
 * - When to put the phone down? When the receptionist ends the call, once its
 *   goodbye has finished playing, unless the caller speaks up first.
 * - What if the caller goes quiet? Check they are still there, then say
 *   goodbye and hang up rather than holding the line open.
 * - What if the recogniser drops? Reconnect; failing that, apologise and hang
 *   up rather than carry on deaf.
 *
 * Transport-free: audio comes in through `audioIn`, and goes out through the
 * `out` callbacks. The browser lab and the phone line differ only there.
 */

import { END_CALL, type ReceptionistEngine, type TurnResult } from "../engine";
import { SentenceChunker } from "./sentences";
import type { SpeechToText, SttStream, TextToSpeech } from "./providers";

export type VoiceEvent =
  | { type: "state"; state: "listening" | "thinking" | "speaking" }
  | { type: "caller"; text: string; final: boolean }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string }
  | { type: "interrupted" }
  | { type: "metrics"; firstAudioMs: number | null; turnMs: number }
  | { type: "ended"; by: "receptionist" }
  | { type: "error"; message: string };

export interface VoiceOut {
  audio(chunk: Buffer): void;
  /** Throw away anything buffered for playback: the caller cut in. */
  clear(): void;
  event(e: VoiceEvent): void;
  /** Put the phone down: the receptionist has said goodbye and it has been heard. */
  hangup?(): void;
}

export interface VoiceCallDeps {
  engine: Pick<ReceptionistEngine, "respond">;
  stt: SpeechToText;
  tts: TextToSpeech;
  out: VoiceOut;
  greeting: string;
  now?: () => number;
  /** Said while a tool runs, if the reply has not started yet. */
  filler?: string;
  /**
   * Silence kept after the goodbye before the line goes down, so its last
   * word is not clipped by the audio still in flight to the far end.
   */
  hangupGraceMs?: number;
  /** Waits; stood in for by tests, which run on their own clock. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * How long a caller may say nothing before being asked if they are still
   * there, and then before the call is ended. Null turns the check off.
   */
  silence?: { promptMs: number; hangupMs: number } | null;
}

export const SILENCE_PROMPT = "Are you still there?";
export const SILENCE_GOODBYE =
  "I think we've lost each other, so I'll let you go. Please do ring back any time. Goodbye.";
export const CANNOT_HEAR =
  "Sorry, I'm having trouble hearing you. Someone from the salon will ring you back. Goodbye.";

const DEFAULT_SILENCE = { promptMs: 8000, hangupMs: 8000 };
/** Attempts to get the recogniser back after it drops, before giving up. */
const STT_RETRIES = 2;
/**
 * How long after its own speech the receptionist still treats hearing its
 * own words as echo. Short: a caller confirming by repeating ("Tuesday at
 * ten") usually does so just after the question, and must be heard.
 */
const ECHO_TAIL_MS = 600;

/**
 * Words heard over the reply before it counts as an interruption. One word is
 * as likely to be "mm" or the line picking up the receptionist's own voice as
 * a real attempt to speak.
 */
const BARGE_IN_WORDS = 2;

export class VoiceCall {
  private stt: SttStream | null = null;
  private readonly now: () => number;

  /** What the caller has said since the last reply started. */
  private heard: string[] = [];
  private interim = "";

  private turn: AbortController | null = null;
  private turnRunning = false;
  /** Serialises speech: sentences play in order, one synthesis at a time. */
  private speech: Promise<void> = Promise.resolve();
  /** When the audio already sent will have finished playing at the far end. */
  private playbackEndsAt = 0;
  private closed = false;
  /**
   * Settles when the model has finished with the latest turn. The next turn
   * waits on it: a booking still being written when the caller talked over it
   * must be in the conversation before the model is asked anything else, or
   * it will make the booking a second time.
   */
  private settling: Promise<void> = Promise.resolve();
  /** Caller words from a turn overtaken before the model ever saw it. */
  private carry = "";
  /** The receptionist's recent words, to tell its own echo from the caller. */
  private recentSpeech = "";
  private lastActivity: number;
  private silencePrompted = false;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private hangingUp = false;

  readonly log: Array<{ who: "caller" | "assistant"; text: string }> = [];
  turns: TurnResult[] = [];

  /** For what the call cost: when it started, audio heard, words spoken. */
  readonly startedAt: number;
  audioBytesIn = 0;
  ttsCharacters = 0;

  constructor(private readonly deps: VoiceCallDeps) {
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.lastActivity = this.startedAt;
  }

  async start(): Promise<void> {
    this.stt = await this.openStt();
    // The greeting can be talked over like any reply.
    this.turn = new AbortController();
    this.say(this.deps.greeting, this.turn.signal);
    this.log.push({ who: "assistant", text: this.deps.greeting });
    this.watchSilence();
  }

  /** Resolves once the model has finished with every turn so far. */
  settled(): Promise<void> {
    return this.settling;
  }

  private openStt(): Promise<SttStream> {
    return this.deps.stt.open({
      onInterim: (text) => this.onInterim(text),
      onFinal: (text) => this.onFinal(text),
      onEndOfTurn: () => this.onEndOfTurn(),
      onError: (err) => this.deps.out.event({ type: "error", message: `Speech recognition: ${err.message}` }),
      onClose: () => void this.recoverStt(),
    });
  }

  /**
   * The recogniser's connection dropped mid-call. Without it the receptionist
   * is deaf, and would sit in silence until the caller gave up. Reconnect, a
   * couple of times if need be; if it will not come back, say so and hang up.
   */
  private async recoverStt() {
    if (this.closed) return;
    this.stt = null;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 1; attempt <= STT_RETRIES; attempt++) {
      await sleep(300 * attempt);
      if (this.closed) return;
      try {
        this.stt = await this.openStt();
        return;
      } catch (err) {
        this.deps.out.event({
          type: "error",
          message: `Speech recognition dropped and did not come back: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    this.sayGoodbyeAndHangUp(CANNOT_HEAR, { evenIfSpokenTo: true });
  }

  /**
   * Silence on the line. Timed from when the receptionist last stopped
   * talking, so its own thinking and speaking never count; any word from the
   * caller starts it again.
   */
  private watchSilence() {
    const silence = this.deps.silence === undefined ? DEFAULT_SILENCE : this.deps.silence;
    if (!silence) return;
    this.silenceTimer = setInterval(() => {
      if (this.closed || this.hangingUp) return;
      const now = this.now();
      if (this.turnRunning || now < this.playbackEndsAt || this.heard.length || this.interim) {
        this.lastActivity = now;
        return;
      }
      const quiet = now - this.lastActivity;
      if (!this.silencePrompted && quiet >= silence.promptMs) {
        this.silencePrompted = true;
        this.lastActivity = now;
        const ctl = new AbortController();
        this.turn = ctl;
        this.say(SILENCE_PROMPT, ctl.signal);
        this.log.push({ who: "assistant", text: SILENCE_PROMPT });
      } else if (this.silencePrompted && quiet >= silence.hangupMs) {
        this.sayGoodbyeAndHangUp(SILENCE_GOODBYE);
      }
    }, 500);
    (this.silenceTimer as { unref?: () => void }).unref?.();
  }

  /** Something from our side ends the call: say why, then hang up once heard. */
  private sayGoodbyeAndHangUp(text: string, opts: { evenIfSpokenTo?: boolean } = {}) {
    this.turn?.abort();
    const ctl = new AbortController();
    this.turn = ctl;
    this.say(text, ctl.signal);
    this.log.push({ who: "assistant", text });
    void this.hangUpAfterGoodbye(ctl, opts);
  }

  audioIn(chunk: Buffer): void {
    if (this.closed) return;
    this.audioBytesIn += chunk.length;
    this.stt?.send(chunk);
  }

  /** Tokens across every turn, including ones cut short by the caller. */
  tokenUsage() {
    return this.turns.reduce(
      (t, r) => ({
        inputTokens: t.inputTokens + r.usage.input,
        outputTokens: t.outputTokens + r.usage.output,
        cacheReadTokens: t.cacheReadTokens + r.usage.cacheRead,
        cacheWriteTokens: t.cacheWriteTokens + r.usage.cacheWrite,
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    this.turn?.abort();
    this.stt?.close();
  }

  /** The receptionist is mid-reply: still thinking, or still audible. */
  private get busy(): boolean {
    return this.turnRunning || this.now() < this.playbackEndsAt;
  }

  /**
   * The receptionist's own words coming back down the line: a caller on
   * speakerphone, or a line without echo cancelling. Heard while it is still
   * talking (or just after) and matching what it is saying, they are not the
   * caller and must neither interrupt it nor become a turn.
   */
  private isEcho(text: string): boolean {
    if (this.now() >= this.playbackEndsAt + ECHO_TAIL_MS) return false;
    const heard = words(text);
    if (heard.length < BARGE_IN_WORDS) return false;
    return ` ${words(this.recentSpeech).join(" ")} `.includes(` ${heard.join(" ")} `);
  }

  private callerSpoke() {
    this.lastActivity = this.now();
    this.silencePrompted = false;
  }

  private onInterim(text: string) {
    if (this.isEcho(text)) return;
    this.interim = text;
    this.callerSpoke();
    this.deps.out.event({ type: "caller", text: [...this.heard, text].join(" "), final: false });
    if (this.busy && wordCount(text) >= BARGE_IN_WORDS) this.interrupt();
  }

  private onFinal(text: string) {
    if (this.isEcho(text)) {
      this.interim = "";
      return;
    }
    this.interim = "";
    this.heard.push(text);
    this.callerSpoke();
    this.deps.out.event({ type: "caller", text: this.heard.join(" "), final: false });
    if (this.busy && wordCount(text) >= BARGE_IN_WORDS) this.interrupt();
  }

  private interrupt() {
    if (!this.turn) return;
    this.turn.abort();
    this.turn = null;
    this.turnRunning = false;
    this.playbackEndsAt = 0;
    this.deps.out.clear();
    this.deps.out.event({ type: "interrupted" });
    this.deps.out.event({ type: "state", state: "listening" });
  }

  private onEndOfTurn() {
    const text = [...this.heard, this.interim].join(" ").replace(/\s+/g, " ").trim();
    if (!text || this.closed) return;
    this.heard = [];
    this.interim = "";
    // Anything still playing from before is superseded by the new turn.
    if (this.busy) this.interrupt();
    this.deps.out.event({ type: "caller", text, final: true });
    this.log.push({ who: "caller", text });
    void this.runTurn(text);
  }

  private async runTurn(text: string) {
    const ctl = new AbortController();
    this.turn = ctl;
    this.turnRunning = true;
    // Wait for the model to finish with the previous turn: see `settling`.
    const previous = this.settling;
    let settle!: () => void;
    this.settling = new Promise<void>((r) => (settle = r));
    await previous;
    if (ctl.signal.aborted) {
      // Overtaken by a newer turn while waiting; its words go with that one.
      this.carry = `${this.carry} ${text}`.trim();
      settle();
      return;
    }
    if (this.carry) {
      text = `${this.carry} ${text}`;
      this.carry = "";
    }
    const started = this.now();
    let firstAudio: number | null = null;
    let spokeThisTurn = false;
    const chunker = new SentenceChunker();
    this.deps.out.event({ type: "state", state: "thinking" });

    const speak = (piece: string) => {
      spokeThisTurn = true;
      this.say(piece, ctl.signal, () => {
        if (firstAudio === null) firstAudio = this.now() - started;
      });
    };

    try {
      const result = await this.deps.engine.respond(
        text,
        {
          onText: (delta) => chunker.push(delta).forEach(speak),
          onToolStart: (name) => {
            // Hanging up is shown as the call ending, after the goodbye, not
            // as a tool ahead of it.
            if (name !== END_CALL) this.deps.out.event({ type: "tool", name });
            // Whatever the model already wrote goes out first, then the filler
            // only if nothing at all has been said yet this turn. Never before
            // hanging up: "One moment" and then the line going dead is worse
            // than silence.
            chunker.flush().forEach(speak);
            if (name !== END_CALL && !spokeThisTurn && this.deps.filler !== "") {
              speak(this.deps.filler ?? "One moment.");
            }
          },
        },
        ctl.signal
      );
      chunker.flush().forEach(speak);
      this.turns.push(result);
      if (result.text.trim()) this.log.push({ who: "assistant", text: result.text.trim() });
      if (result.endCall) void this.hangUpAfterGoodbye(ctl);
    } catch (err) {
      if (!ctl.signal.aborted) {
        this.deps.out.event({ type: "error", message: err instanceof Error ? err.message : String(err) });
        speak("Sorry, I'm having a little trouble. Someone from the salon will ring you back.");
      }
    } finally {
      settle();
      if (this.turn === ctl) this.turnRunning = false;
      // Metrics once the speech queue has caught up with this turn.
      void this.speech.then(() => {
        if (ctl.signal.aborted) return;
        this.deps.out.event({ type: "metrics", firstAudioMs: firstAudio, turnMs: this.now() - started });
        if (this.turn === ctl) this.deps.out.event({ type: "state", state: "listening" });
      });
    }
  }

  /**
   * Once the goodbye has been synthesised and has had time to play out, put
   * the phone down. Called off if the caller cut in or started a new turn in
   * the meantime ("oh, one more thing"): the call carries on.
   */
  private async hangUpAfterGoodbye(ctl: AbortController, opts: { evenIfSpokenTo?: boolean } = {}) {
    this.hangingUp = true;
    await this.speech;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(Math.max(0, this.playbackEndsAt - this.now()) + (this.deps.hangupGraceMs ?? 800));
    const spokenTo = ctl.signal.aborted || this.turn !== ctl || this.heard.length > 0 || this.interim !== "";
    if (this.closed || (spokenTo && !opts.evenIfSpokenTo)) {
      this.hangingUp = false;
      return;
    }
    this.deps.out.event({ type: "ended", by: "receptionist" });
    this.close();
    this.deps.out.hangup?.();
  }

  /** Queue one piece of speech. Dropped if the turn it belongs to is aborted. */
  private say(text: string, signal: AbortSignal, onFirstAudio?: () => void) {
    this.speech = this.speech.then(async () => {
      if (signal.aborted || this.closed) return;
      // Billed per character requested, whether or not it all gets played.
      this.ttsCharacters += text.length;
      this.recentSpeech = `${this.recentSpeech} ${text}`.slice(-400);
      this.deps.out.event({ type: "assistant", text });
      let first = true;
      try {
        for await (const chunk of this.deps.tts.synth(text, signal)) {
          if (signal.aborted || this.closed) return;
          if (first) {
            first = false;
            onFirstAudio?.();
            this.deps.out.event({ type: "state", state: "speaking" });
          }
          this.deps.out.audio(chunk);
          const secs = chunk.length / this.deps.tts.bytesPerSecond;
          this.playbackEndsAt = Math.max(this.playbackEndsAt, this.now()) + secs * 1000;
        }
      } catch (err) {
        if (!signal.aborted) {
          this.deps.out.event({ type: "error", message: `Speech: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    });
  }
}

/** Lower-case words without punctuation, for comparing what was said with what was heard. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
