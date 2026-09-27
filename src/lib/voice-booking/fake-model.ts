/**
 * Development only: a stand-in for the model behind booking by voice, so the
 * whole path (microphone, words, card, save) can be tried with no API key.
 * Switched on with VOICE_BOOKING_FAKE_MODEL=1, never in production.
 *
 * It understands one shape, "Name, service, day at time [with stylist]", and
 * "make that <time>". It calls the real tools, so the card, the rules and the
 * save are the real ones; only the reading of the sentence is faked.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { StreamingClient } from "@/lib/receptionist/engine";

interface Asked {
  name: string;
  service: string;
  date: string;
  time: string;
  stylist?: string;
}

export function fakeBookingModel(): StreamingClient {
  let asked: Asked | null = null;
  let clientId: string | undefined;
  let n = 0;

  const reply = (content: Anthropic.ContentBlock[]): Anthropic.Message =>
    ({
      id: `fake_${n++}`,
      type: "message",
      role: "assistant",
      model: "fake",
      content,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    }) as unknown as Anthropic.Message;
  const tool = (name: string, input: object) =>
    reply([{ type: "tool_use", id: `f${n}`, name, input } as Anthropic.ToolUseBlock]);
  const say = (text: string) => reply([{ type: "text", text, citations: null } as Anthropic.TextBlock]);
  const propose = () =>
    tool("propose_booking", {
      ...(clientId ? { clientId } : { clientName: asked!.name }),
      service: asked!.service,
      date: asked!.date,
      time: asked!.time,
      stylist: asked!.stylist,
    });

  return {
    messages: {
      stream(params) {
        const last = params.messages[params.messages.length - 1];
        const blocks = typeof last.content === "string" ? [] : last.content;
        const result = blocks.find((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result");
        const text =
          typeof last.content === "string"
            ? last.content
            : blocks
                .filter((b): b is Anthropic.TextBlockParam => b.type === "text")
                .map((b) => b.text)
                .join(" ");

        let message: Anthropic.Message;
        if (result) {
          const data = JSON.parse(String(result.content));
          if (data.clients) {
            const exact = data.clients.find((c: { exactMatch: boolean }) => c.exactMatch);
            clientId = exact?.clientId;
            message = propose();
          } else if (data.shownOnScreen) {
            message = say(`${data.shownOnScreen}. Save it?`);
          } else {
            message = say(data.message ?? "That didn't work.");
          }
        } else {
          const change = /^make (?:that|it) (.+)$/i.exec(text.trim());
          const m = /^(.+?),\s*(.+?),\s*(.+?)\s+at\s+(.+?)(?:\s+with\s+(\w+))?\.?$/i.exec(text.trim());
          if (change && asked) {
            asked.time = change[1];
            message = propose();
          } else if (m) {
            asked = { name: m[1], service: m[2], date: m[3], time: m[4], stylist: m[5] };
            clientId = undefined;
            message = tool("find_client", { name: asked.name });
          } else {
            message = say('Say it as "name, service, day at time".');
          }
        }
        let onText: ((d: string) => void) | null = null;
        return {
          on(_e: "text", l: (d: string) => void) {
            onText = l;
            return this;
          },
          async finalMessage() {
            await new Promise((r) => setTimeout(r, 100));
            for (const b of message.content) if (b.type === "text") onText?.(b.text);
            return message;
          },
        };
      },
    },
  };
}
