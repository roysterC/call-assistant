/**
 * One line in Call History per call our receptionist answers: who rang, when,
 * for how long, what it came to, and the transcript.
 *
 * The transcript is kept for training while the receptionist is in testing:
 * what the caller said, what it said back, and every tool it used with what
 * the tool answered. Text only; no audio is kept. It is kept indefinitely for
 * now. Before real callers, the greeting and privacy policy need to say so,
 * and a retention period needs choosing.
 *
 * Lab calls are never logged: they are Kikai's tests, not the salon's
 * callers. The phone line calls this when a call ends.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";
import type { CallOutcome } from "./outcomes";

export type TranscriptLine =
  | { who: "caller" | "receptionist"; text: string }
  | { who: "tool"; name: string; input: unknown; result: unknown };

/** The stand-in first user turn (receptionist/session.ts): not something anyone said. */
const CONNECTED = "[The call has connected.]";

/**
 * The conversation as it happened, from the engine's history: each tool call
 * set beside its result, in the order they were made.
 */
export function transcriptOf(messages: Anthropic.MessageParam[]): TranscriptLine[] {
  const results = new Map<string, unknown>();
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_result") results.set(b.tool_use_id, readResult(b.content));
    }
  }
  const lines: TranscriptLine[] = [];
  for (const m of messages) {
    const who = m.role === "user" ? "caller" : "receptionist";
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === "text") {
        const text = b.text.trim();
        if (text && text !== CONNECTED) lines.push({ who, text });
      } else if (b.type === "tool_use") {
        lines.push({ who: "tool", name: b.name, input: b.input, result: results.get(b.id) ?? null });
      }
    }
  }
  return lines;
}

/** A tool's answer as sent to the model: JSON text read back into an object where it is one. */
function readResult(content: Anthropic.ToolResultBlockParam["content"]): unknown {
  const text =
    typeof content === "string"
      ? content
      : (content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function logCall(
  organizationId: string,
  call: {
    callerNumber: string | null;
    startedAt: Date;
    endedAt: Date;
    outcomes: CallOutcome[];
    transcript?: TranscriptLine[];
  }
): Promise<void> {
  const phone = normalisePhone(call.callerNumber ?? undefined);
  const lead = phone.ok
    ? await prisma.lead.findUnique({
        where: { organizationId_phone: { organizationId, phone: phone.e164 } },
        select: { id: true },
      })
    : null;
  await prisma.call.create({
    data: {
      organizationId,
      phoneNumber: phone.ok ? phone.e164 : "Withheld",
      status: "completed",
      duration: Math.max(0, Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)),
      outcomes: call.outcomes,
      ...(call.transcript ? { transcript: call.transcript as unknown as object } : {}),
      leadId: lead?.id ?? null,
      createdAt: call.startedAt,
    },
  });
}
