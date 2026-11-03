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

import { END_CALL, type ReceptionistEngine, type Speculation, type TurnResult } from "../engine";
import { callOutcomes, type CallOutcome } from "../outcomes";
import { SentenceChunker } from "./sentences";
import type { SpeechToText, SttStream, TextToSpeech } from "./providers";

export type VoiceEvent =
  | { type: "state"; state: "listening" | "thinking" | "speaking" }
  | { type: "caller"; text: string; final: boolean }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string }
  | { type: "interrupted" }
  | {
      type: "metrics";
      /** From the end of the caller's turn being called to the reply's first audio. */
      firstAudioMs: number | null;
      /**
       * From the recogniser last handing over the caller's words to the
       * reply's first audio: the pause the caller sits through, less the
       * recogniser's own lag and the line's.
       */
      sinceHeardMs: number | null;
      /**
       * Where sinceHeardMs went, in order; null where the turn never got
       * that far. endOfTurn: from their last words to deciding they had
       * finished (and any previous turn settling). model: to the model's
       * first text or tool. sentence: to a whole first sentence (or the
       * filler) being ready to speak. voice: to the voice's first audio.
       */
      parts: { endOfTurnMs: number; modelMs: number | null; sentenceMs: number | null; voiceMs: number | null };
      /** A tool (a diary lookup, a booking) ran before anything was said. */
      lookup: boolean;
      /** The reply was started early, before the caller's turn ended, and that start was used. */
      startedEarly: boolean;
      /** This turn's input tokens: read from the cache, written to it, and read uncached. */
      tokens: { cacheRead: number; cacheWrite: number; uncached: number } | null;
      turnMs: number;
    }
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
  /** speculate is optional: without it, replies are never started early. */
  engine: Pick<ReceptionistEngine, "respond"> & Partial<Pick<ReceptionistEngine, "speculate">>;
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
  /**
   * How long the caller's words must stay unchanged before the reply is
   * started early, ahead of the recogniser deciding they have finished.
   * Null never starts early.
   */
  startEarlyAfterMs?: number | null;
  /** Runs fn after ms, returning a cancel; stood in for by tests. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /**
   * Whether the caller can cut the receptionist off by talking over it. Off
   * by default: it always finishes what it is saying, and whatever the caller
   * said meanwhile is the next turn, answered once it has finished.
   */
  interruptible?: boolean;
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

/**
 * The early start. The recogniser only says a caller has finished after
 * 400ms of silence, and the model only started then. Once their words have
 * stood still this long, the model is started on them; if that was the end
 * of their turn, the reply is that much further on when the turn ends. More
 * words cancel it. Short, because a pause this long mid-sentence costs only a
 * cancelled request, and Haiku requests are cheap.
 */
const START_EARLY_AFTER_MS = 150;

/**
 * How long to wait for the rest of a sentence the caller stopped part-way
 * through ("I'm looking for…", "can I get half…"). The recogniser calls a
 * turn over after 0.4s of silence, mid-phrase or not, and the receptionist
 * answered half a question: "half" became "Sorry, I don't have half past
 * today" when they meant half past four. Their words resuming cancels the
 * wait; if none come, the turn goes ahead as it was.
 */
const UNFINISHED_HOLD_MS = 1200;

/**
 * Words a sentence does not end on: articles, prepositions, conjunctions,
 * fillers, and the openings of a time or a request. "Can I get half" and
 * "I'm looking for" end on one; "a men's cut" and "Thursday at 3" do not.
 */
const DANGLING = new Set([
  "a", "an", "the", "my", "your", "his", "her", "our", "their", "some", "any",
  "for", "to", "at", "on", "in", "of", "with", "from", "about", "by", "into", "after", "before", "around", "till", "until",
  "and", "or", "but", "so", "because", "if", "then",
  "um", "uh", "er", "erm", "hmm", "like",
  "half", "quarter", "past",
  "i'm", "i", "im", "can", "could", "would", "will", "is", "it's", "its", "get", "have", "need", "want", "looking", "book", "be",
]);

/** The caller's words stop part-way through a sentence. */
export function soundsUnfinished(text: string): boolean {
  const trimmed = text.trim();
  // A full stop or question mark from the recogniser means it heard an end.
  if (/[.?!]$/.test(trimmed)) return false;
  const last = words(trimmed).at(-1);
  return last !== undefined && DANGLING.has(last);
}

export class VoiceCall {
  private stt: SttStream | null = null;
  private readonly now: () => number;

  /** What the caller has said since the last reply started. */
  private heard: string[] = [];
  private interim = "";
  /** When the recogniser last handed over any of the caller's words. */
  private lastHeardAt = 0;

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
  /** The receptionist put the phone down (after a goodbye), not the caller. */
  private endedByReceptionist = false;
  /** A reply started early on the caller's words so far: see START_EARLY_AFTER_MS. */
  private early: Speculation | null = null;
  private cancelEarlyTimer: (() => void) | null = null;
  /** Turns the model is still working on; an early start waits for none. */
  private modelTurns = 0;
  /** Turns whose reply has begun to be spoken: those always play out. */
  private readonly spoke = new WeakSet<AbortController>();
  /** Waiting for the rest of an unfinished sentence: see UNFINISHED_HOLD_MS. */
  private cancelHold: (() => void) | null = null;
  private held = false;

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

  /**
   * What the call came to, for Call History: what was booked, moved,
   * cancelled or left as a message, or else an enquiry or a hang-up. Read
   * once the call has ended and settled().
   */
  outcomes(): CallOutcome[] {
    return callOutcomes(this.turns, this.endedByReceptionist);
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
    this.dropEarly();
    this.cancelHold?.();
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
    this.lastHeardAt = this.now();
    this.callerSpoke();
    this.deps.out.event({ type: "caller", text: [...this.heard, text].join(" "), final: false });
    if (this.deps.interruptible && this.busy && wordCount(text) >= BARGE_IN_WORDS) this.interrupt();
    this.wordsChanged();
  }

  private onFinal(text: string) {
    if (this.isEcho(text)) {
      this.interim = "";
      return;
    }
    this.interim = "";
    this.heard.push(text);
    this.lastHeardAt = this.now();
    this.callerSpoke();
    this.deps.out.event({ type: "caller", text: this.heard.join(" "), final: false });
    if (this.deps.interruptible && this.busy && wordCount(text) >= BARGE_IN_WORDS) this.interrupt();
    this.wordsChanged();
  }

  /** What the caller has said this turn, settled words and those still coming. */
  private callerSoFar(): string {
    return [...this.heard, this.interim].join(" ").replace(/\s+/g, " ").trim();
  }

  /** New words: an early start on older ones is out of date; time a new one. */
  private wordsChanged() {
    // They went on talking: whatever was being waited for has come.
    if (this.cancelHold) {
      this.cancelHold();
      this.cancelHold = null;
      this.held = false;
    }
    this.cancelEarlyTimer?.();
    this.cancelEarlyTimer = null;
    if (this.early && !sameWords(this.early.callerText, this.callerSoFar())) this.dropEarly();
    const after = this.deps.startEarlyAfterMs === undefined ? START_EARLY_AFTER_MS : this.deps.startEarlyAfterMs;
    if (after === null || !this.deps.engine.speculate) return;
    this.cancelEarlyTimer = this.scheduler()(() => this.startEarly(), after);
  }

  private scheduler(): (fn: () => void, ms: number) => () => void {
    return (
      this.deps.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      })
    );
  }

  /**
   * The caller's words have stood still: start the reply on them. Not while
   * the receptionist is talking or the model is still on an earlier turn, and
   * not with words carried over from an overtaken turn: those go in first.
   */
  private startEarly() {
    this.cancelEarlyTimer = null;
    if (this.closed || this.hangingUp || this.busy || this.modelTurns > 0 || this.carry) return;
    const text = this.callerSoFar();
    if (!text || (this.early && sameWords(this.early.callerText, text))) return;
    this.dropEarly();
    this.early = this.deps.engine.speculate?.(text) ?? null;
  }

  private dropEarly() {
    this.cancelEarlyTimer?.();
    this.cancelEarlyTimer = null;
    this.early?.cancel();
    this.early = null;
  }

  /** Drop the reply being worked on, before any of it is said: nothing to cut off. */
  private overtake() {
    this.turn?.abort();
    this.turn = null;
    this.turnRunning = false;
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
    // Stopped part-way through a sentence: give them a moment to finish it,
    // once. Their next words cancel the wait (wordsChanged), and the next end
    // of turn is judged afresh on everything they said. While waiting, a
    // further end-of-turn signal changes nothing: the recogniser sends a
    // backstop one about a second after the first, which cut the wait short
    // ("My name is" answered before "Roy").
    if (this.cancelHold) return;
    if (!this.held && soundsUnfinished(text)) {
      this.held = true;
      this.cancelHold = this.scheduler()(() => {
        this.cancelHold = null;
        this.onEndOfTurn();
      }, UNFINISHED_HOLD_MS);
      return;
    }
    this.held = false;
    this.heard = [];
    this.interim = "";
    // Interruptible: anything still playing is superseded by the new turn.
    // Otherwise what it has begun to say plays out, and the reply to this
    // turn follows it (speech is queued in order; the model waits for the last
    // turn to settle). A reply not yet begun is replaced, unheard, so the
    // caller gets one answer to everything they said, not one per breath.
    if (this.deps.interruptible) {
      if (this.busy) this.interrupt();
    } else if (this.turn && this.turnRunning && !this.spoke.has(this.turn)) {
      this.overtake();
    }
    this.deps.out.event({ type: "caller", text, final: true });
    this.log.push({ who: "caller", text });
    // Started early on these same words: the reply carries on from there.
    // The model is given the words it was started on (the final transcript
    // can differ in a comma or a capital).
    const early = this.early && sameWords(this.early.callerText, text) ? this.early : null;
    if (early) this.early = null;
    this.dropEarly();
    void this.runTurn(early ? early.callerText : text, this.lastHeardAt, early);
  }

  private async runTurn(text: string, heardAt: number, early: Speculation | null = null) {
    this.modelTurns++;
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
      early?.cancel();
      this.modelTurns--;
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
    // When each stage of the reply first happened, for the metrics.
    let firstOutputAt: number | null = null;
    let firstSpeakAt: number | null = null;
    let lookup = false;
    let usage: { input: number; cacheRead: number; cacheWrite: number } | null = null;
    let startedEarly = false;
    const output = () => {
      if (firstOutputAt === null) firstOutputAt = this.now();
    };
    const chunker = new SentenceChunker();
    this.deps.out.event({ type: "state", state: "thinking" });

    const speak = (piece: string) => {
      spokeThisTurn = true;
      this.spoke.add(ctl);
      if (firstSpeakAt === null) firstSpeakAt = this.now();
      this.say(piece, ctl.signal, () => {
        if (firstAudio === null) firstAudio = this.now() - started;
      });
    };

    try {
      const result = await this.deps.engine.respond(
        text,
        {
          onText: (delta) => {
            output();
            chunker.push(delta).forEach(speak);
          },
          onToolStart: (name) => {
            output();
            if (firstSpeakAt === null && name !== END_CALL) lookup = true;
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
        ctl.signal,
        ...(early ? [{ head: early }] : [])
      );
      chunker.flush().forEach(speak);
      usage = result.usage;
      startedEarly = early !== null && !early.signal.aborted;
      this.turns.push(result);
      if (result.text.trim()) this.log.push({ who: "assistant", text: result.text.trim() });
      if (result.endCall) void this.hangUpAfterGoodbye(ctl);
    } catch (err) {
      if (!ctl.signal.aborted) {
        this.deps.out.event({ type: "error", message: err instanceof Error ? err.message : String(err) });
        speak("Sorry, I'm having a little trouble. Someone from the salon will ring you back.");
      }
    } finally {
      this.modelTurns--;
      settle();
      if (this.turn === ctl) this.turnRunning = false;
      // Metrics once the speech queue has caught up with this turn.
      void this.speech.then(() => {
        if (ctl.signal.aborted) return;
        this.deps.out.event({
          type: "metrics",
          firstAudioMs: firstAudio,
          sinceHeardMs: firstAudio === null ? null : started + firstAudio - heardAt,
          parts: {
            endOfTurnMs: started - heardAt,
            modelMs: firstOutputAt === null ? null : firstOutputAt - started,
            sentenceMs: firstOutputAt === null || firstSpeakAt === null ? null : firstSpeakAt - firstOutputAt,
            voiceMs: firstSpeakAt === null || firstAudio === null ? null : started + firstAudio - firstSpeakAt,
          },
          lookup,
          startedEarly,
          tokens: usage && { cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, uncached: usage.input },
          turnMs: this.now() - started,
        });
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
    this.endedByReceptionist = true;
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

/** The same words, whatever the punctuation or capitals: "Thursday at 3?" and "thursday at 3". */
function sameWords(a: string, b: string): boolean {
  return words(a).join(" ") === words(b).join(" ");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
