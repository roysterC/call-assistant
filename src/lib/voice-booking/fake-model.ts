/**
 * Development only: a stand-in for the model behind booking by voice, so the
 * whole path (microphone, words, card, save) can be tried with no API key.
 * Switched on with VOICE_BOOKING_FAKE_MODEL=1, never in production.
 *
 * It understands a few shapes: "Name, service, day at time [with stylist]
 * [and text her]", "make that <time>", "add a note for <name>: <note>",
 * "how much did we take this week", "what's my day". It calls the real tools,
 * so the cards, the rules, the answers and the saves are the real ones; only
 * the reading of the sentence is faked.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { StreamingClient } from "@/lib/receptionist/engine";

interface Asked {
  name: string;
  service: string;
  date: string;
  time: string;
  stylist?: string;
  text?: boolean;
}

export function fakeBookingModel(): StreamingClient {
  let asked: Asked | null = null;
  let clientId: string | undefined;
  let noteText: string | null = null;
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
      textClient: asked!.text,
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
            if (noteText !== null) {
              message = exact ? tool("propose_note", { clientId, note: noteText }) : say("I can't find that client.");
              noteText = null;
            } else {
              message = propose();
            }
          } else if (data.taken) {
            message = say(`${data.period}: you took ${data.taken} across ${data.appointmentsDone} appointments.`);
          } else if (data.closed) {
            message = say(`${data.date}: the salon is closed.`);
          } else if (data.stylists) {
            const n = data.stylists.reduce((t: number, st: { appointments: unknown[] }) => t + st.appointments.length, 0);
            message = say(`${data.date}: ${n} appointments in the diary.`);
          } else if (data.shownOnScreen) {
            message = say(`${data.shownOnScreen}. Save it?`);
          } else {
            message = say(data.message ?? "That didn't work.");
          }
        } else {
          const change = /^make (?:that|it) (.+)$/i.exec(text.trim());
          const texting = /,?\s+and text (?:her|him|them)\.?$/i.test(text.trim());
          const m = /^(.+?),\s*(.+?),\s*(.+?)\s+at\s+(.+?)(?:\s+with\s+(\w+))?\.?$/i.exec(
            text.trim().replace(/,?\s+and text (?:her|him|them)\.?$/i, "")
          );
          const note = /^add a note for (.+?):\s*(.+)$/i.exec(text.trim());
          const money = /how much did we take (this|last) (day|week|month|year)/i.exec(text);
          const dayAsk = /what'?s (?:my|the) (?:day|afternoon|morning)|who'?s in (today|tomorrow)/i.exec(text);
          if (money) {
            message = tool("takings", { period: money[2].toLowerCase(), offset: money[1].toLowerCase() === "last" ? -1 : 0 });
          } else if (dayAsk) {
            message = tool("day_schedule", { date: dayAsk[1] ?? "today" });
          } else if (note) {
            noteText = note[2];
            message = tool("find_client", { name: note[1] });
          } else if (change && asked) {
            asked.time = change[1];
            message = propose();
          } else if (m) {
            asked = { name: m[1], service: m[2], date: m[3], time: m[4], stylist: m[5], text: texting };
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
