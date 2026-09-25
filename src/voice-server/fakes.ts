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
import type { SpeechToText, SttHandlers, TextToSpeech } from "@/lib/receptionist/voice/providers";

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
  readonly bytesPerSecond = 32000; // 16kHz 16-bit mono

  async *synth(text: string, signal: AbortSignal): AsyncIterable<Buffer> {
    // ~60ms of a quiet 440Hz tone per word, sent in 100ms chunks.
    const seconds = Math.max(0.4, text.split(/\s+/).length * 0.06);
    const total = Math.round(seconds * 16000);
    const chunk = 1600;
    for (let start = 0; start < total; start += chunk) {
      if (signal.aborted) return;
      const n = Math.min(chunk, total - start);
      const buf = Buffer.alloc(n * 2);
      for (let i = 0; i < n; i++) {
        buf.writeInt16LE(Math.round(Math.sin(((start + i) / 16000) * 2 * Math.PI * 440) * 3000), i * 2);
      }
      await new Promise((r) => setTimeout(r, 20));
      yield buf;
    }
  }
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
        const text = toolTurn
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
            const content = toolTurn
              ? [{ type: "tool_use", id: `f${i}`, name: "check_availability", input: { date: "Tuesday", service: "cut and finish" } }]
              : [{ type: "text", text }];
            return {
              id: `fake_${i}`,
              type: "message",
              role: "assistant",
              model: "fake",
              content,
              stop_reason: toolTurn ? "tool_use" : "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            } as unknown as Anthropic.Message;
          },
        };
      },
    },
  };
}
