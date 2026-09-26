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
 *
 * Transport-free: audio comes in through `audioIn`, and goes out through the
 * `out` callbacks. The browser lab and the phone line differ only there.
 */

import type { ReceptionistEngine, TurnResult } from "../engine";
import { SentenceChunker } from "./sentences";
import type { SpeechToText, SttStream, TextToSpeech } from "./providers";

export type VoiceEvent =
  | { type: "state"; state: "listening" | "thinking" | "speaking" }
  | { type: "caller"; text: string; final: boolean }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string }
  | { type: "interrupted" }
  | { type: "metrics"; firstAudioMs: number | null; turnMs: number }
  | { type: "error"; message: string };

export interface VoiceOut {
  audio(chunk: Buffer): void;
  /** Throw away anything buffered for playback: the caller cut in. */
  clear(): void;
  event(e: VoiceEvent): void;
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
}

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

  readonly log: Array<{ who: "caller" | "assistant"; text: string }> = [];
  turns: TurnResult[] = [];

  /** For what the call cost: when it started, audio heard, words spoken. */
  readonly startedAt: number;
  audioBytesIn = 0;
  ttsCharacters = 0;

  constructor(private readonly deps: VoiceCallDeps) {
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
  }

  async start(): Promise<void> {
    this.stt = await this.deps.stt.open({
      onInterim: (text) => this.onInterim(text),
      onFinal: (text) => this.onFinal(text),
      onEndOfTurn: () => this.onEndOfTurn(),
      onError: (err) => this.deps.out.event({ type: "error", message: `Speech recognition: ${err.message}` }),
    });
    // The greeting can be talked over like any reply.
    this.turn = new AbortController();
    this.say(this.deps.greeting, this.turn.signal);
    this.log.push({ who: "assistant", text: this.deps.greeting });
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
    this.turn?.abort();
    this.stt?.close();
  }

  /** The receptionist is mid-reply: still thinking, or still audible. */
  private get busy(): boolean {
    return this.turnRunning || this.now() < this.playbackEndsAt;
  }

  private onInterim(text: string) {
    this.interim = text;
    this.deps.out.event({ type: "caller", text: [...this.heard, text].join(" "), final: false });
    if (this.busy && wordCount(text) >= BARGE_IN_WORDS) this.interrupt();
  }

  private onFinal(text: string) {
    this.interim = "";
    this.heard.push(text);
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
            this.deps.out.event({ type: "tool", name });
            // Whatever the model already wrote goes out first, then the filler
            // only if nothing at all has been said yet this turn.
            chunker.flush().forEach(speak);
            if (!spokeThisTurn && this.deps.filler !== "") speak(this.deps.filler ?? "One moment.");
          },
        },
        ctl.signal
      );
      chunker.flush().forEach(speak);
      this.turns.push(result);
      if (result.text.trim()) this.log.push({ who: "assistant", text: result.text.trim() });
    } catch (err) {
      if (!ctl.signal.aborted) {
        this.deps.out.event({ type: "error", message: err instanceof Error ? err.message : String(err) });
        speak("Sorry, I'm having a little trouble. Someone from the salon will ring you back.");
      }
    } finally {
      if (this.turn === ctl) this.turnRunning = false;
      // Metrics once the speech queue has caught up with this turn.
      void this.speech.then(() => {
        if (ctl.signal.aborted) return;
        this.deps.out.event({ type: "metrics", firstAudioMs: firstAudio, turnMs: this.now() - started });
        if (this.turn === ctl) this.deps.out.event({ type: "state", state: "listening" });
      });
    }
  }

  /** Queue one piece of speech. Dropped if the turn it belongs to is aborted. */
  private say(text: string, signal: AbortSignal, onFirstAudio?: () => void) {
    this.speech = this.speech.then(async () => {
      if (signal.aborted || this.closed) return;
      // Billed per character requested, whether or not it all gets played.
      this.ttsCharacters += text.length;
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

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
