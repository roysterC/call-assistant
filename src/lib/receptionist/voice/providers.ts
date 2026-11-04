/**
 * Hearing and speaking, behind interfaces small enough to swap.
 *
 * The call logic only needs "tell me what the caller said, and when they
 * finished" and "turn this sentence into audio". Deepgram and ElevenLabs are
 * the first implementations; a different provider is a new class here, not a
 * change to the call.
 */

import WebSocket from "ws";

// --- Speech to text ------------------------------------------------------------

export interface SttHandlers {
  /** Words heard so far in the current stretch of speech, still changing. */
  onInterim(text: string): void;
  /** A stretch of speech the recogniser has settled on. */
  onFinal(text: string): void;
  /** The caller has paused long enough to count as having finished. */
  onEndOfTurn(): void;
  /**
   * Probably finished, not yet certain (Flux's EagerEndOfTurn): a reply may
   * be started on these words. If the turn does end, its words are exactly
   * these.
   */
  onEagerEndOfTurn?(text: string): void;
  /** They carried on after an eager end: whatever was started is out of date. */
  onTurnResumed?(): void;
  /**
   * They have begun to speak (Flux's StartOfTurn). Deepgram's own barge-in
   * signal: every one carries real words, so silence and noise do not start
   * one. Recognisers without it leave it unset.
   */
  onStartOfTurn?(text: string): void;
  onError(err: Error): void;
  /** The connection went down without being asked to. */
  onClose?(): void;
}

export interface SttStream {
  /** Raw caller audio, in the format the stream was opened with. */
  send(audio: Buffer): void;
  close(): void;
  /**
   * Change how the recogniser listens, mid-call, for the answer about to be
   * given (Flux's Configure): more patient for a phone number, digits on for
   * one. Recognisers that cannot leave it unset.
   */
  configure?(listening: Listening): void;
}

/** How to listen for the next answer: see listeningFor in call.ts. */
export interface Listening {
  eotThreshold: number;
  eagerEotThreshold: number | null;
  eotTimeoutMs: number;
  numerals: boolean;
}

export interface SpeechToText {
  open(handlers: SttHandlers): Promise<SttStream>;
  /**
   * Ends turns by what was said, not only by silence, and says when a reply
   * may start early (Flux). The call then leaves turn-taking to it, rather
   * than waiting out unfinished sentences and timing early starts itself.
   */
  readonly detectsTurns?: boolean;
}

export type AudioEncoding =
  /** 16-bit little-endian PCM, mono: the browser lab. */
  | { kind: "pcm16"; sampleRate: number }
  /** 8kHz mu-law, mono: the phone network. */
  | { kind: "mulaw8k" };

export interface DeepgramOptions {
  model?: string;
  language?: string;
  endpointingMs?: number;
  /** The salon's own words to listen for: see keyterms.ts. */
  keyterms?: string[];
}

/** The streaming address, with everything the recogniser is told up front. */
export function deepgramListenUrl(encoding: AudioEncoding, opts: DeepgramOptions = {}): string {
  const model = opts.model ?? "nova-3";
  const params = new URLSearchParams({
    model,
    language: opts.language ?? "en",
    encoding: encoding.kind === "pcm16" ? "linear16" : "mulaw",
    sample_rate: String(encoding.kind === "pcm16" ? encoding.sampleRate : 8000),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    // How long a pause ends a turn. Too short and callers get talked over
    // mid-thought ("it's oh seven seven… double oh"); too long and every
    // reply starts late. Tuned in the lab.
    endpointing: String(opts.endpointingMs ?? 400),
    // Backstop for when the endpoint is missed in noise.
    utterance_end_ms: "1000",
    vad_events: "true",
  });
  // Keyterm prompting is a Nova-3 feature; older models refuse the stream.
  if (model.startsWith("nova-3")) {
    for (const term of opts.keyterms ?? []) params.append("keyterm", term);
  }
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

export class DeepgramStt implements SpeechToText {
  constructor(
    private readonly apiKey: string,
    private readonly encoding: AudioEncoding,
    private readonly opts: DeepgramOptions = {}
  ) {}

  open(handlers: SttHandlers): Promise<SttStream> {
    const ws = new WebSocket(deepgramListenUrl(this.encoding, this.opts), {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    return new Promise((resolve, reject) => {
      let keepAlive: NodeJS.Timeout | null = null;
      let lastAudio = Date.now();
      let opened = false;
      let closing = false;

      ws.on("open", () => {
        // Deepgram closes an idle stream after ~10s with no audio.
        keepAlive = setInterval(() => {
          if (Date.now() - lastAudio > 5000 && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 4000);
        opened = true;
        resolve({
          send(audio) {
            if (ws.readyState !== WebSocket.OPEN) return;
            lastAudio = Date.now();
            ws.send(audio);
          },
          close() {
            closing = true;
            if (keepAlive) clearInterval(keepAlive);
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
            setTimeout(() => ws.terminate(), 1000).unref?.();
          },
        });
      });
      ws.on("message", (raw) => {
        let msg: {
          type?: string;
          is_final?: boolean;
          speech_final?: boolean;
          channel?: { alternatives?: Array<{ transcript?: string }> };
        };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === "Results") {
          const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
          if (msg.is_final) {
            if (text) handlers.onFinal(text);
            if (msg.speech_final) handlers.onEndOfTurn();
          } else if (text) {
            handlers.onInterim(text);
          }
        } else if (msg.type === "UtteranceEnd") {
          handlers.onEndOfTurn();
        }
      });
      ws.on("error", (err) => {
        handlers.onError(err);
        reject(err);
      });
      ws.on("close", () => {
        if (keepAlive) clearInterval(keepAlive);
        // Dropped by Deepgram or the network mid-call: the call must know,
        // or it goes on without hearing anything.
        if (opened && !closing) handlers.onClose?.();
      });
    });
  }
}

// --- Flux: speech to text that knows when a turn has ended ----------------------

export interface FluxOptions {
  model?: string;
  /** How sure it must be that they have finished before ending the turn (0.5 to 1). */
  eotThreshold?: number;
  /** How sure before a reply may be started early (0.3 to 1, and at most eotThreshold); null for never. */
  eagerEotThreshold?: number | null;
  /** Silence that ends a turn whatever was said, in ms (500 to 60000). */
  eotTimeoutMs?: number;
  keyterms?: string[];
  /**
   * Where to connect. Deepgram's EU region by default: the voice server is in
   * Germany, so audio and transcripts no longer cross the Atlantic. The same
   * API key works there. It has no failover, so DEEPGRAM_HOST (e.g.
   * wss://api.deepgram.com) switches back if it is ever down. Tests point it
   * at a stand-in server.
   */
  host?: string;
}

/**
 * Settled for a salon's phone line: patient with someone thinking mid-
 * sentence (a higher bar than Deepgram's default 0.7 before calling a turn
 * over), and starting replies early when fairly sure. Deepgram's guide puts
 * tool-calling agents at 0.4 / 0.85; these sit a little further from false
 * starts and a little nearer to quick replies.
 */
export const FLUX_DEFAULTS = { eotThreshold: 0.8, eagerEotThreshold: 0.5, eotTimeoutMs: 6000 } as const;

/** The streaming address for Flux, with everything it is told up front. */
export function fluxListenUrl(encoding: AudioEncoding, opts: FluxOptions = {}): string {
  const eot = opts.eotThreshold ?? FLUX_DEFAULTS.eotThreshold;
  const eager = opts.eagerEotThreshold === undefined ? FLUX_DEFAULTS.eagerEotThreshold : opts.eagerEotThreshold;
  const params = new URLSearchParams({
    model: opts.model ?? "flux-general-en",
    encoding: encoding.kind === "pcm16" ? "linear16" : "mulaw",
    sample_rate: String(encoding.kind === "pcm16" ? encoding.sampleRate : 8000),
    eot_threshold: String(eot),
    eot_timeout_ms: String(opts.eotTimeoutMs ?? FLUX_DEFAULTS.eotTimeoutMs),
    // No `numerals`: it turned "quarter to twelve" into "0.25 to 12" on the
    // first Flux call. Times and numbers in words are read here already.
  });
  // Above the end-of-turn bar Deepgram refuses the stream; capped there.
  if (eager !== null) params.set("eager_eot_threshold", String(Math.min(eager, eot)));
  for (const term of opts.keyterms ?? []) params.append("keyterm", term);
  return `${opts.host ?? DEEPGRAM_EU}/v2/listen?${params}`;
}

export const DEEPGRAM_EU = "wss://api.eu.deepgram.com";

/** Flux's mid-call Configure message for a way of listening (thresholds clamped as Flux requires). */
export function fluxConfigureMessage(l: Listening): string {
  const thresholds: Record<string, number> = { eot_threshold: l.eotThreshold, eot_timeout_ms: l.eotTimeoutMs };
  if (l.eagerEotThreshold !== null) thresholds.eager_eot_threshold = Math.min(l.eagerEotThreshold, l.eotThreshold);
  return JSON.stringify({ type: "Configure", thresholds, numerals: l.numerals });
}

/** Audio per message: Deepgram strongly recommends 80ms for Flux; the phone sends 20ms. */
const FLUX_CHUNK_MS = 80;

/**
 * Deepgram's Flux, which ends a caller's turn when what they said, and how,
 * says they have finished (EndOfTurn), and says earlier when they probably
 * have (EagerEndOfTurn) or have carried on after all (TurnResumed). Its
 * transcript is the whole turn so far each time.
 */
export class FluxStt implements SpeechToText {
  readonly detectsTurns = true;
  private readonly chunkBytes: number;

  constructor(
    private readonly apiKey: string,
    private readonly encoding: AudioEncoding,
    private readonly opts: FluxOptions = {}
  ) {
    const bytesPerSecond = encoding.kind === "pcm16" ? encoding.sampleRate * 2 : 8000;
    this.chunkBytes = Math.round((bytesPerSecond * FLUX_CHUNK_MS) / 1000);
  }

  open(handlers: SttHandlers): Promise<SttStream> {
    const ws = new WebSocket(fluxListenUrl(this.encoding, this.opts), {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    const chunkBytes = this.chunkBytes;

    return new Promise((resolve, reject) => {
      let opened = false;
      let closing = false;
      let pending: Buffer[] = [];
      let pendingBytes = 0;
      const flush = () => {
        if (!pendingBytes || ws.readyState !== WebSocket.OPEN) return;
        ws.send(pending.length === 1 ? pending[0] : Buffer.concat(pending));
        pending = [];
        pendingBytes = 0;
      };

      ws.on("open", () => {
        opened = true;
        resolve({
          send(audio) {
            if (ws.readyState !== WebSocket.OPEN) return;
            pending.push(audio);
            pendingBytes += audio.length;
            if (pendingBytes >= chunkBytes) flush();
          },
          close() {
            closing = true;
            flush();
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
            setTimeout(() => ws.terminate(), 1000).unref?.();
          },
          configure(listening) {
            // In order with the audio: anything still held goes first.
            flush();
            if (ws.readyState === WebSocket.OPEN) ws.send(fluxConfigureMessage(listening));
          },
        });
      });
      ws.on("message", (raw) => handleFluxMessage(raw.toString(), handlers));
      ws.on("error", (err) => {
        handlers.onError(err);
        reject(err);
      });
      ws.on("close", () => {
        if (opened && !closing) handlers.onClose?.();
      });
    });
  }
}

/**
 * One message from Flux, passed on as the call's recogniser events. The
 * transcript is the whole turn so far each time, so it goes on as the words
 * still coming until the turn ends, and then as what was said.
 */
export function handleFluxMessage(raw: string, handlers: SttHandlers): void {
  let msg: { type?: string; event?: string; transcript?: string; description?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === "TurnInfo") {
    const text = msg.transcript?.trim() ?? "";
    switch (msg.event) {
      case "StartOfTurn":
        handlers.onStartOfTurn?.(text);
        if (text) handlers.onInterim(text);
        break;
      case "Update":
        if (text) handlers.onInterim(text);
        break;
      case "EagerEndOfTurn":
        if (text) handlers.onEagerEndOfTurn?.(text);
        break;
      case "TurnResumed":
        handlers.onTurnResumed?.();
        if (text) handlers.onInterim(text);
        break;
      case "EndOfTurn":
        if (text) handlers.onFinal(text);
        handlers.onEndOfTurn();
        break;
    }
  } else if (msg.type === "Error") {
    handlers.onError(new Error(msg.description ?? "Flux error"));
  } else if (msg.type === "ConfigureFailure") {
    // The stream carries on as it was; worth knowing, not worth ending a call.
    console.warn("[FLUX] a change to how it listens was refused:", msg.description ?? "no reason given");
  }
}

/**
 * The recogniser for a stream: Flux unless DEEPGRAM_MODEL names a Nova model
 * (nova-3 brings back the silence-timed turns, as before Flux).
 */
export function speechToText(
  apiKey: string,
  encoding: AudioEncoding,
  opts: DeepgramOptions & { flux?: Omit<FluxOptions, "model" | "keyterms"> } = {}
): SpeechToText {
  const model = opts.model ?? "flux-general-en";
  if (model.startsWith("flux")) return new FluxStt(apiKey, encoding, { ...opts.flux, model, keyterms: opts.keyterms });
  return new DeepgramStt(apiKey, encoding, { ...opts, model });
}

// --- Text to speech ------------------------------------------------------------

export interface TextToSpeech {
  /** Audio for one piece of text, streamed as it is made. */
  synth(text: string, signal: AbortSignal): AsyncIterable<Buffer>;
  /** Bytes per second of the audio produced, for knowing how long it plays. */
  readonly bytesPerSecond: number;
}

/** The ElevenLabs voice model used unless ELEVENLABS_MODEL says otherwise. */
export const DEFAULT_TTS_MODEL = "eleven_v4_turbo";

export class ElevenLabsTts implements TextToSpeech {
  readonly bytesPerSecond: number;
  private readonly format: string;

  constructor(
    private readonly apiKey: string,
    encoding: AudioEncoding,
    private readonly opts: { voiceId?: string; model?: string; speed?: number } = {}
  ) {
    if (encoding.kind === "mulaw8k") {
      this.format = "ulaw_8000";
      this.bytesPerSecond = 8000;
    } else {
      this.format = `pcm_${encoding.sampleRate}`;
      this.bytesPerSecond = encoding.sampleRate * 2;
    }
  }

  async *synth(text: string, signal: AbortSignal): AsyncIterable<Buffer> {
    // A British voice from ElevenLabs' standard library by default; any voice
    // on the account can be set instead.
    const voice = this.opts.voiceId ?? "Xb7hH8MSUJpSbSDYk0k2";
    const request = () =>
      fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=${this.format}`, {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          // v4 Turbo: ElevenLabs' most expressive real-time voice, at the
          // same price per character as Flash v2.5 and, in testing, as quick
          // to start. ELEVENLABS_MODEL=eleven_flash_v2_5 goes back to Flash.
          model_id: this.opts.model ?? DEFAULT_TTS_MODEL,
          voice_settings: { speed: speakingSpeed(this.opts.speed) },
        }),
        signal,
      });
    // Busy (too many requests at once: the free plan allows very few) or a
    // passing fault on their side: try again shortly rather than lose the
    // sentence. A refusal that will not change — a bad key, a used-up plan,
    // a voice not on the plan — is not retried.
    let res = await request();
    for (let attempt = 1; attempt <= 2 && (res.status === 429 || res.status >= 500); attempt++) {
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, 250 * attempt));
      if (signal.aborted) return;
      res = await request();
    }
    if (!res.ok || !res.body) {
      throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(() => "")}`);
    }
    yield* evenChunks(res.body, this.format.startsWith("pcm") ? 2 : 1);
  }
}

/**
 * How fast the receptionist talks, as ElevenLabs takes it: 1 is the voice's
 * natural pace. Kept within 0.7 to 1.2, the range ElevenLabs gives for voice
 * agents; further out, the speech starts to sound processed. Slightly under 1 by default,
 * because a caller writing down a time or a price needs a moment more than a
 * listener to a narration does. Anything unset or unreadable falls back to it.
 */
export const DEFAULT_SPEAKING_SPEED = 0.9;

export function speakingSpeed(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_SPEAKING_SPEED;
  return Math.min(1.2, Math.max(0.7, value));
}

/**
 * The sample rate the lab's voice is made at. Kept apart from the microphone's
 * 16kHz: the recogniser needs no more, but a voice at 16kHz loses everything
 * above 8kHz — the hiss of an "s", the snap of a "t" — and sounds muffled next
 * to the same voice on ElevenLabs' site. 24kHz keeps nearly all of it and is
 * on every ElevenLabs plan; 44.1kHz PCM needs a paid one. Only rates
 * ElevenLabs offers as PCM are taken; anything else falls back to 24kHz.
 */
export const DEFAULT_LAB_VOICE_RATE = 24000;
const PCM_RATES = [8000, 16000, 22050, 24000, 44100, 48000];

export function labVoiceRate(value: string | undefined): number {
  const n = Number(value);
  return PCM_RATES.includes(n) ? n : DEFAULT_LAB_VOICE_RATE;
}

/**
 * Re-cut a byte stream so no chunk splits a sample. A 16-bit sample torn
 * across two network chunks plays as a click.
 */
export async function* evenChunks(
  body: ReadableStream<Uint8Array>,
  sampleBytes: number
): AsyncIterable<Buffer> {
  let carry = Buffer.alloc(0);
  const reader = body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const all = carry.length ? Buffer.concat([carry, Buffer.from(value)]) : Buffer.from(value);
    const usable = all.length - (all.length % sampleBytes);
    if (usable) yield all.subarray(0, usable);
    carry = all.subarray(usable);
  }
}
