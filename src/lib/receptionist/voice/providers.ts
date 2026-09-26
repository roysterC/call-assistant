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
  onError(err: Error): void;
}

export interface SttStream {
  /** Raw caller audio, in the format the stream was opened with. */
  send(audio: Buffer): void;
  close(): void;
}

export interface SpeechToText {
  open(handlers: SttHandlers): Promise<SttStream>;
}

export type AudioEncoding =
  /** 16-bit little-endian PCM, mono: the browser lab. */
  | { kind: "pcm16"; sampleRate: number }
  /** 8kHz mu-law, mono: the phone network. */
  | { kind: "mulaw8k" };

export class DeepgramStt implements SpeechToText {
  constructor(
    private readonly apiKey: string,
    private readonly encoding: AudioEncoding,
    private readonly opts: { model?: string; language?: string; endpointingMs?: number } = {}
  ) {}

  open(handlers: SttHandlers): Promise<SttStream> {
    const params = new URLSearchParams({
      model: this.opts.model ?? "nova-3",
      language: this.opts.language ?? "en",
      encoding: this.encoding.kind === "pcm16" ? "linear16" : "mulaw",
      sample_rate: String(this.encoding.kind === "pcm16" ? this.encoding.sampleRate : 8000),
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      // How long a pause ends a turn. Too short and callers get talked over
      // mid-thought ("it's oh seven seven… double oh"); too long and every
      // reply starts late. Tuned in the lab.
      endpointing: String(this.opts.endpointingMs ?? 400),
      // Backstop for when the endpoint is missed in noise.
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    return new Promise((resolve, reject) => {
      let keepAlive: NodeJS.Timeout | null = null;
      let lastAudio = Date.now();

      ws.on("open", () => {
        // Deepgram closes an idle stream after ~10s with no audio.
        keepAlive = setInterval(() => {
          if (Date.now() - lastAudio > 5000 && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 4000);
        resolve({
          send(audio) {
            if (ws.readyState !== WebSocket.OPEN) return;
            lastAudio = Date.now();
            ws.send(audio);
          },
          close() {
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
      });
    });
  }
}

// --- Text to speech ------------------------------------------------------------

export interface TextToSpeech {
  /** Audio for one piece of text, streamed as it is made. */
  synth(text: string, signal: AbortSignal): AsyncIterable<Buffer>;
  /** Bytes per second of the audio produced, for knowing how long it plays. */
  readonly bytesPerSecond: number;
}

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
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=${this.format}`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: this.opts.model ?? "eleven_flash_v2_5",
          voice_settings: { speed: speakingSpeed(this.opts.speed) },
        }),
        signal,
      }
    );
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
