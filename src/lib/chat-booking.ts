/**
 * Booking by message: WhatsApp, Instagram and Messenger book into the diary
 * with the same tools, checks and read-back as the phone receptionist.
 *
 * Nail clients book by message far more than by phone, and until this the
 * chats could only say "ring the salon". Switched on per salon by Kikai
 * (OrganizationSettings.chatBookingEnabled), and only where the salon's own
 * diary is set up to take bookings.
 *
 * A call keeps its whole conversation in memory; a chat arrives one message
 * at a time, often minutes apart. So what the receptionist needs between
 * messages is saved (ChatSession): its history with the diary checks in it,
 * so a time offered in one message is still the exact time in the next, and
 * what was last read back, so "yes" in the next message books exactly that
 * and nothing else (read-back.ts). After a quiet spell it starts again from
 * the messages themselves.
 *
 * The messages shown in the inbox stay in the channel's own tables; this
 * only decides the reply.
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getSalonConfig, selectProvider } from "@/lib/booking";
import { buildVoiceTools } from "@/lib/receptionist/tool-definitions";
import { runAction, handleBookAppointment, isActionName, normaliseParameters } from "@/lib/receptionist/actions";
import { ReadBackGate, type ReadBackState } from "@/lib/receptionist/read-back";
import { ClientTypeMemory } from "@/lib/receptionist/client-type-memory";
import { ReceptionistEngine, type StreamingClient } from "@/lib/receptionist/engine";
import { buildChatSystem, type ChatChannel } from "@/lib/receptionist/prompt";
import { toClaudeTools, withCallerContext } from "@/lib/receptionist/tools";
import { receptionistApiKey, receptionistModel, receptionistRequestOptions } from "@/lib/receptionist/session";
import { attachPhotosToBooking } from "@/lib/chat-photos";
import { bookedByMessageNote } from "@/lib/booked-by";

/** After this long without a message, the conversation starts afresh from its messages. */
export const CHAT_SESSION_IDLE_MS = 12 * 60 * 60_000;

/** Saved history is cut to about this many entries, from the front. */
const KEEP_MESSAGES = 60;

/** What is kept between messages besides the history. */
interface SavedState {
  readBack: ReadBackState | null;
  clientTypes: Record<string, "new" | "returning">;
  /** Messages they have sent: the read-back only books on a later one. */
  turns: number;
}

const FRESH: SavedState = { readBack: null, clientTypes: {}, turns: 0 };

/** Whether this salon's chats book: switched on, and a diary that takes bookings. */
export async function chatBookingOn(organizationId: string): Promise<boolean> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { chatBookingEnabled: true },
  });
  if (!settings?.chatBookingEnabled) return false;
  const cfg = await getSalonConfig(organizationId);
  return selectProvider(cfg).capabilities.createBooking;
}

export interface ChatTurn {
  organizationId: string;
  channel: ChatChannel;
  /** The channel's conversation row. */
  conversationId: string;
  /** The conversation's earlier messages, oldest first, not including this one. */
  earlier: Array<{ role: string; content: string }>;
  text: string;
  /** Their number, where the channel gives one (WhatsApp). */
  phone: string | null;
  /** The conversation was reset after a prompt change: nothing saved before it counts. */
  resetAt?: Date | null;
  client?: StreamingClient;
  now?: Date;
}

/**
 * The webhooks' way in: the receptionist's reply where this salon's chats
 * book, or null for the plain chat reply (not switched on, no diary, or
 * something went wrong, which is logged).
 */
export async function bookingReply(turn: ChatTurn): Promise<string | null> {
  try {
    if (!(await chatBookingOn(turn.organizationId))) return null;
    return await bookingChatReply(turn);
  } catch (err) {
    console.error(`[CHAT BOOKING] ${turn.channel} reply failed, falling back to the plain chat:`, err);
    return null;
  }
}

/** The reply to one message. One conversation's messages are answered one at a time. */
export function bookingChatReply(turn: ChatTurn): Promise<string> {
  const key = `${turn.channel}:${turn.conversationId}`;
  const before = queue.get(key) ?? Promise.resolve();
  const next = before.catch(() => {}).then(() => reply(turn));
  queue.set(key, next);
  // The caller hears about a failure from `next`; this chain only tidies up.
  next
    .finally(() => {
      if (queue.get(key) === next) queue.delete(key);
    })
    .catch(() => {});
  return next;
}

const queue = new Map<string, Promise<string>>();

async function reply(turn: ChatTurn): Promise<string> {
  const { organizationId, channel, conversationId, phone } = turn;
  const now = turn.now ?? new Date();

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { businessName: true, voiceSystemPrompt: true, salonFaq: true },
  });
  const key = turn.client ? null : await receptionistApiKey(organizationId);
  if (!turn.client && !key) throw new Error("No Anthropic API key for this salon.");
  const cfg = await getSalonConfig(organizationId);
  const tools = toClaudeTools(buildVoiceTools(selectProvider(cfg).capabilities));
  const allowed = new Set(tools.map((t) => t.name));

  const saved = await prisma.chatSession.findUnique({
    where: { channel_conversationId: { channel, conversationId } },
  });
  const fresh =
    !saved ||
    now.getTime() - saved.updatedAt.getTime() > CHAT_SESSION_IDLE_MS ||
    Boolean(turn.resetAt && turn.resetAt > saved.createdAt);
  const state: SavedState = fresh ? FRESH : { ...FRESH, ...(saved.state as unknown as Partial<SavedState>) };
  const history = fresh ? fromMessages(turn.earlier) : (saved.messages as unknown as Anthropic.MessageParam[]);

  const clientTypes = new ClientTypeMemory(state.clientTypes);
  const readBack = new ReadBackGate(
    {
      turn: () => engine.turns,
      check: (input) =>
        handleBookAppointment(
          organizationId,
          normaliseParameters(withCallerContext("book_appointment", input, phone)) as Parameters<
            typeof handleBookAppointment
          >[1],
          { dryRun: true }
        ),
      book: async (input) => {
        const result = await runAction(
          "book_appointment",
          organizationId,
          withCallerContext("book_appointment", { ...input, notes: withChannelNote(input.notes, channel) }, phone)
        );
        // Any photo they sent (the design they want) goes with the booking.
        const n = (result as { success?: boolean; bookingNumber?: unknown } | null) ?? null;
        if (n?.success && typeof n.bookingNumber === "number") {
          await attachPhotosToBooking({ organizationId, channel, conversationId, bookingNumber: n.bookingNumber, now }).catch(
            (err) => console.error("[CHAT BOOKING] photos not linked to the booking:", err)
          );
        }
        return result;
      },
    },
    state.readBack
  );

  const engine: ReceptionistEngine = new ReceptionistEngine({
    client: turn.client ?? new Anthropic({ apiKey: key!.apiKey }),
    model: receptionistModel(),
    request: receptionistRequestOptions(receptionistModel()),
    system: buildChatSystem(
      cfg,
      settings?.businessName ?? "",
      channel,
      settings?.voiceSystemPrompt ?? null,
      now,
      phone,
      settings?.salonFaq ?? null
    ),
    tools,
    execute: async (name, said) => {
      const input = clientTypes.apply(name, said);
      if (name === "prepare_booking" && allowed.has(name)) return readBack.prepare(input);
      if (name === "book_appointment" && allowed.has(name)) return readBack.book(input);
      if (!allowed.has(name) || !isActionName(name)) return { error: `There is no tool called ${name}.` };
      return runAction(name, organizationId, withCallerContext(name, input, phone));
    },
  });
  engine.messages.push(...history);
  engine.turns = state.turns;

  const result = await engine.respond(turn.text);
  const text = result.text.trim() || "Sorry, something went wrong there. Could you send that again?";

  const keep: SavedState = { readBack: readBack.state(), clientTypes: clientTypes.entries(), turns: engine.turns };
  const data = {
    messages: forSaving(engine.messages) as unknown as Prisma.InputJsonValue,
    state: keep as unknown as Prisma.InputJsonValue,
  };
  await prisma.chatSession.upsert({
    where: { channel_conversationId: { channel, conversationId } },
    create: { organizationId, channel, conversationId, ...data },
    // Started afresh: it counts from now, so an earlier reset is behind it.
    update: fresh ? { ...data, createdAt: now } : data,
  });
  return text;
}

/** The booking's notes, saying where it was booked: the diary otherwise shows "booked by phone". */
export function withChannelNote(notes: unknown, channel: ChatChannel): string {
  const own = typeof notes === "string" ? notes.trim() : "";
  return [own, bookedByMessageNote(channel)].filter(Boolean).join(" ");
}

/**
 * The conversation's own messages as a history to carry on from: text only,
 * starting with theirs, empty ones left out.
 */
export function fromMessages(rows: Array<{ role: string; content: string }>): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const r of rows) {
    const content = r.content?.trim();
    if (!content) continue;
    const role = r.role === "user" ? "user" : "assistant";
    if (out.length === 0 && role !== "user") continue;
    out.push({ role, content });
  }
  return out;
}

/**
 * The history as saved: the model's reasoning left out (only the model that
 * wrote it reads it, and it is not needed to carry on), and cut from the
 * front to a message of theirs, so a tool call is never kept without its
 * result.
 */
export function forSaving(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const cleaned = messages.map((m) => {
    if (typeof m.content === "string" || m.role !== "assistant") return m;
    const content = m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
    return { ...m, content: content.length ? content : [{ type: "text" as const, text: "…" }] };
  });
  let start = Math.max(0, cleaned.length - KEEP_MESSAGES);
  while (start < cleaned.length && !isTheirWords(cleaned[start])) start++;
  return cleaned.slice(start);
}

function isTheirWords(m: Anthropic.MessageParam): boolean {
  if (m.role !== "user") return false;
  return typeof m.content === "string" || !m.content.some((b) => b.type === "tool_result");
}
