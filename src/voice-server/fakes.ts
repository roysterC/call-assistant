/**
 * Stand-ins for the model, the recogniser and the voice, for exercising the
 * audio path locally with no provider accounts.
 *
 * Enabled only by VOICE_FAKES=1 outside production. The recogniser is driven
 * by text the lab page sends ("pretend I said…"), the voice is a tone whose
 * length follows the text, and the model echoes what it heard and checks the
 * diary when asked about a day, so the tool-filler path runs too.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { StreamingClient } from "@/lib/receptionist/engine";
import type { AudioEncoding, SpeechToText, SttHandlers, TextToSpeech } from "@/lib/receptionist/voice/providers";

export class FakeStt implements SpeechToText {
  handlers: SttHandlers | null = null;
  bytesHeard = 0;

  async open(handlers: SttHandlers) {
    this.handlers = handlers;
    return {
      send: (audio: Buffer) => {
        this.bytesHeard += audio.length;
      },
      close: () => {},
    };
  }

  /** As if the caller said this and then paused. */
  say(text: string) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 1) this.handlers?.onInterim(words.slice(0, 2).join(" "));
    this.handlers?.onFinal(text);
    this.handlers?.onEndOfTurn();
  }
}

export class FakeTts implements TextToSpeech {
  readonly bytesPerSecond: number;
  private readonly rate: number;
  private readonly mulaw: boolean;

  constructor(encoding: AudioEncoding = { kind: "pcm16", sampleRate: 16000 }) {
    this.mulaw = encoding.kind === "mulaw8k";
    this.rate = encoding.kind === "mulaw8k" ? 8000 : encoding.sampleRate;
    this.bytesPerSecond = this.mulaw ? 8000 : this.rate * 2;
  }

  async *synth(text: string, signal: AbortSignal): AsyncIterable<Buffer> {
    // ~60ms of a quiet 440Hz tone per word, sent in 100ms chunks.
    const seconds = Math.max(0.4, text.split(/\s+/).length * 0.06);
    const total = Math.round(seconds * this.rate);
    const chunk = this.rate / 10;
    for (let start = 0; start < total; start += chunk) {
      if (signal.aborted) return;
      const n = Math.min(chunk, total - start);
      const buf = Buffer.alloc(this.mulaw ? n : n * 2);
      for (let i = 0; i < n; i++) {
        const v = Math.round(Math.sin(((start + i) / this.rate) * 2 * Math.PI * 440) * 3000);
        if (this.mulaw) buf[i] = linearToMulaw(v);
        else buf.writeInt16LE(v, i * 2);
      }
      await new Promise((r) => setTimeout(r, 20));
      yield buf;
    }
  }
}

/** G.711 mu-law encoding of one 16-bit sample. */
function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  const v = Math.min(Math.abs(sample), 32635) + 0x84;
  let exponent = 7;
  for (let mask = 0x4000; (v & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (v >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function fakeModel(): StreamingClient {
  let n = 0;
  return {
    messages: {
      stream(params) {
        const i = n++;
        const last = params.messages[params.messages.length - 1];
        const wantsDiary =
          typeof last.content === "string" && /monday|tuesday|wednesday|thursday|friday|saturday/i.test(last.content);
        const toolTurn = wantsDiary && typeof last.content === "string";
        // "Bye" from the caller: say goodbye and hang up, as the real one should.
        const hangUp = typeof last.content === "string" && /\b(bye|goodbye)\b/i.test(last.content);
        const text = hangUp
          ? "Thanks for calling, bye for now!"
          : toolTurn
          ? ""
          : typeof last.content === "string"
            ? `You said: ${last.content}. Is there anything else?`
            : "I've had a look, and there's space that day. Shall I book it?";
        let onText: ((d: string) => void) | null = null;
        return {
          on(_e: "text", l: (d: string) => void) {
            onText = l;
            return this;
          },
          async finalMessage() {
            await new Promise((r) => setTimeout(r, 150)); // model thinking time
            for (const word of text.split(/(?<= )/)) onText?.(word);
            const content = hangUp
              ? [{ type: "text", text }, { type: "tool_use", id: `f${i}`, name: "end_call", input: {} }]
              : toolTurn
              ? [{ type: "tool_use", id: `f${i}`, name: "check_availability", input: { date: "Tuesday", service: "cut and finish" } }]
              : [{ type: "text", text }];
            return {
              id: `fake_${i}`,
              type: "message",
              role: "assistant",
              model: "fake",
              content,
              stop_reason: toolTurn || hangUp ? "tool_use" : "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            } as unknown as Anthropic.Message;
          },
        };
      },
    },
  };
}
