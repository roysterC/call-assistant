/**
 * The receptionist on WhatsApp, Instagram and Messenger: for every salon that
 * uses the diary, the same instructions, tools and checks as the phone, in
 * the chat's own style. Where booking by message is on and the diary can
 * take bookings, it books, with the same read-back as the phone; otherwise
 * it gives the salon's number or takes a request for the salon to ring them
 * (chatCallbackRules), rather than the old plain chat bot answering.
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
import { buildVoiceTools, REQUEST_QUOTE } from "@/lib/receptionist/tool-definitions";
import { isQuoteChannel, requestQuote } from "@/lib/quotes";
import { runAction, handleBookAppointment, isActionName, normaliseParameters } from "@/lib/receptionist/actions";
import { ReadBackGate, type ReadBackState } from "@/lib/receptionist/read-back";
import { ClientTypeMemory } from "@/lib/receptionist/client-type-memory";
import { ReceptionistEngine, type StreamingClient } from "@/lib/receptionist/engine";
import { buildChatSystem, COLLEAGUE_PREFIX, type ChatChannel } from "@/lib/receptionist/prompt";
import { manualProvider } from "@/lib/booking/providers/manual";
import { hasDiary } from "@/lib/navigation";
import { toClaudeTools, withCallerContext } from "@/lib/receptionist/tools";
import { receptionistApiKey, receptionistModel, receptionistRequestOptions } from "@/lib/receptionist/session";
import { attachPhotosToBooking } from "@/lib/chat-photos";
import { bookedByMessageNote } from "@/lib/booked-by";

/** After this long without a message, the conversation starts afresh from its messages. */
export const CHAT_SESSION_IDLE_MS = 12 * 60 * 60_000;

/** Saved history is cut to about this many entries, from the front. */
const KEEP_MESSAGES = 60;

/** Starting afresh, at most this many of the conversation's own messages are carried over. */
export const CARRY_MESSAGES = 10;

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

/**
 * How this organisation's chats answer: "book" where booking by message is
 * on and the diary takes bookings; "messages" (the number, or a call back)
 * for any other salon using the diary; null for the plain chat, for a
 * business that does not use the diary at all (Kikai's own chats).
 */
export type ChatMode = "book" | "messages";

export async function chatMode(organizationId: string): Promise<ChatMode | null> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { chatBookingEnabled: true, diaryEnabled: true, voiceEnabled: true },
  });
  if (!settings || !hasDiary(settings)) return null;
  return (await chatBookingOn(organizationId)) ? "book" : "messages";
}

/** One of the conversation's stored messages: theirs ("user"), the bot's, or the salon's staff ("agent"). */
export interface ChatRow {
  role: string;
  content: string;
  createdAt?: Date;
}

export interface ChatTurn {
  organizationId: string;
  channel: ChatChannel;
  /** The channel's conversation row. */
  conversationId: string;
  /** The conversation's earlier messages, oldest first, not including the ones being answered. */
  earlier: ChatRow[];
  /** Everything they have sent since the last reply, as one. */
  text: string;
  /** Their number, where the channel gives one (WhatsApp). */
  phone: string | null;
  /** The conversation was reset after a prompt change: nothing saved before it counts. */
  resetAt?: Date | null;
  client?: StreamingClient;
  now?: Date;
  /** "messages" when this chat cannot book; "book" if not given. */
  mode?: ChatMode;
  /** Filled in as the reply goes, so a failure after a booking still says it is booked. */
  outcome?: ChatOutcome;
  /**
   * Told the number (and name) they gave, each time a tool is given one: for
   * a channel with no number of its own (the website chat) to find the
   * client the booking or message was filed under.
   */
  onContact?: (contact: { phone: string; name: string | null }) => void;
}

export interface ChatOutcome {
  booked?: { service: string; stylist: string; startsAt: string; textSent: boolean; timeZone: string };
}

/**
 * The webhooks' way in: the receptionist's reply for a salon using the diary,
 * or null for the plain chat (a business that does not use it). Never fails:
 * it tries twice, and then sends a short apology with the salon's number,
 * or, if a booking was made before it failed, says so. It never hands a
 * conversation to the plain chat half way, which knows nothing of it.
 */
export async function chatReply(turn: ChatTurn): Promise<string | null> {
  let mode: ChatMode | null;
  try {
    mode = await chatMode(turn.organizationId);
  } catch (err) {
    console.error(`[CHAT] ${turn.channel}: could not tell how this salon's chats answer:`, err);
    return null;
  }
  if (!mode) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome: ChatOutcome = {};
    try {
      return await bookingChatReply({ ...turn, mode, outcome });
    } catch (err) {
      console.error(`[CHAT] ${turn.channel} reply failed (attempt ${attempt}):`, err);
      // Booked before it failed: trying again would ask to book it twice.
      if (outcome.booked) return bookedText(outcome.booked);
    }
  }
  return sorryText(await contactPhoneFor(turn.organizationId));
}

/** Said when a reply failed after the booking was made: what the booking is. */
export function bookedText(b: NonNullable<ChatOutcome["booked"]>): string {
  const at = new Date(b.startsAt);
  const day = at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: b.timeZone });
  const time = at
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: b.timeZone })
    .replace(":00", "")
    .replace(/\s/g, "")
    .toLowerCase();
  return `You're booked: ${b.service} with ${b.stylist}, ${day} at ${time}.${b.textSent ? " A text is on its way." : ""}`;
}

/** Said when no reply could be written: never an error message. */
export function sorryText(contactPhone: string | null): string {
  return (
    "Sorry, I couldn't reply properly just then. Could you send that again in a minute?" +
    (contactPhone ? ` Or ring us on ${contactPhone}.` : "")
  );
}

async function contactPhoneFor(organizationId: string): Promise<string | null> {
  try {
    const s = await prisma.organizationSettings.findUnique({ where: { organizationId }, select: { contactPhone: true } });
    return s?.contactPhone ?? null;
  } catch {
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
    select: { businessName: true, voiceSystemPrompt: true, salonFaq: true, contactPhone: true },
  });
  const key = turn.client ? null : await receptionistApiKey(organizationId);
  if (!turn.client && !key) throw new Error("No Anthropic API key for this salon.");
  const cfg = await getSalonConfig(organizationId);
  const canBook = turn.mode !== "messages";
  // A price for designs from their pictures, in the chats that take pictures.
  const tools = toClaudeTools([
    ...buildVoiceTools(canBook ? selectProvider(cfg).capabilities : manualProvider.capabilities),
    ...(isQuoteChannel(channel) ? [REQUEST_QUOTE] : []),
  ]);
  const allowed = new Set(tools.map((t) => t.name));

  const saved = await prisma.chatSession.findUnique({
    where: { channel_conversationId: { channel, conversationId } },
  });
  const fresh =
    !saved ||
    now.getTime() - saved.updatedAt.getTime() > CHAT_SESSION_IDLE_MS ||
    Boolean(turn.resetAt && turn.resetAt > saved.createdAt);
  const state: SavedState = fresh ? FRESH : { ...FRESH, ...(saved.state as unknown as Partial<SavedState>) };
  // Afresh: the conversation's own recent messages. Carrying on: what was
  // saved, and anything the salon's staff have written since.
  const carried = fresh ? carryOver(turn.earlier, now) : null;
  const history = carried
    ? carried.messages
    : withColleague(
        saved!.messages as unknown as Anthropic.MessageParam[],
        turn.earlier.filter((r) => r.role === "agent" && (!r.createdAt || r.createdAt > saved!.updatedAt))
      );
  const colleague = turn.earlier.some((r) => r.role === "agent");

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
        const n = (result as {
          success?: boolean;
          bookingNumber?: unknown;
          service?: string;
          stylist?: string;
          startsAt?: string;
          textSent?: boolean;
        } | null) ?? null;
        if (n?.success && turn.outcome && n.service && n.stylist && n.startsAt) {
          turn.outcome.booked = {
            service: n.service,
            stylist: n.stylist,
            startsAt: n.startsAt,
            textSent: n.textSent === true,
            timeZone: cfg.timeZone,
          };
        }
        // Any photo they sent (the design they want) goes with the booking.
        // The website chat takes none.
        if (n?.success && typeof n.bookingNumber === "number" && channel !== "website") {
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
      settings?.salonFaq ?? null,
      {
        canBook,
        contactPhone: settings?.contactPhone ?? null,
        colleague,
      }
    ),
    tools,
    execute: async (name, said) => {
      const input = clientTypes.apply(name, said);
      if (turn.onContact && typeof input.customerPhone === "string" && input.customerPhone.trim()) {
        turn.onContact({
          phone: input.customerPhone.trim(),
          name: typeof input.customerName === "string" && input.customerName.trim() ? input.customerName.trim() : null,
        });
      }
      if (name === "prepare_booking" && allowed.has(name)) return readBack.prepare(input);
      if (name === "book_appointment" && allowed.has(name)) return readBack.book(input);
      if (name === "request_quote" && allowed.has(name) && isQuoteChannel(channel)) {
        return requestQuote({
          organizationId,
          channel,
          conversationId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          request: input.request,
          now,
        });
      }
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
 * starting with theirs, empty ones left out, the salon's staff marked as
 * theirs, and one after another from the same side joined into one.
 */
export function fromMessages(rows: ChatRow[]): Anthropic.MessageParam[] {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const r of rows) {
    const text = r.content?.trim();
    if (!text) continue;
    const role = r.role === "user" ? "user" : "assistant";
    if (out.length === 0 && role !== "user") continue;
    const content = r.role === "agent" ? `${COLLEAGUE_PREFIX} ${text}` : text;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role, content });
  }
  return out;
}

/**
 * Starting afresh: only what was said within a session's span (the last
 * CARRY_MESSAGES of the past CHAT_SESSION_IDLE_MS), so a message after a
 * quiet spell is a new conversation. Older messages used to come back, up to
 * a fortnight of them, with a note to check rather than assume; the
 * receptionist still picked up where it left off, offering a time found days
 * before that had since gone. What is kept is a recent reply from the salon's
 * staff, which their message may well be answering.
 */
export function carryOver(rows: ChatRow[], now: Date): { messages: Anthropic.MessageParam[] } {
  const since = now.getTime() - CHAT_SESSION_IDLE_MS;
  const recent = rows
    .filter((r) => r.content?.trim() && (!r.createdAt || r.createdAt.getTime() >= since))
    .slice(-CARRY_MESSAGES);
  // A history starts with their words; one that starts with the salon's
  // (a staff reply after the quiet spell) says what came before is left out,
  // rather than losing the reply they are likely answering.
  const lead: ChatRow[] = recent.length > 0 && recent[0].role !== "user" ? [{ role: "user", content: EARLIER_LEFT_OUT }] : [];
  return { messages: fromMessages([...lead, ...recent]) };
}

/** Stands in for their messages from before a quiet spell. */
export const EARLIER_LEFT_OUT = "[Their earlier messages, from before a quiet spell, are left out.]";

/** The saved history with what the salon's staff wrote since, as the salon's side of it. */
export function withColleague(history: Anthropic.MessageParam[], staff: ChatRow[]): Anthropic.MessageParam[] {
  const lines = staff.map((r) => r.content?.trim()).filter(Boolean).map((t) => `${COLLEAGUE_PREFIX} ${t}`);
  if (lines.length === 0) return history;
  const out = [...history];
  const last = out[out.length - 1];
  // Joined onto the last reply, which is the salon's side too: two in a row
  // from one side is not a conversation.
  if (last?.role === "assistant") {
    const blocks: Anthropic.ContentBlockParam[] =
      typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
    out[out.length - 1] = { role: "assistant", content: [...blocks, ...lines.map((text) => ({ type: "text" as const, text }))] };
  } else {
    out.push({ role: "assistant", content: lines.join("\n\n") });
  }
  return out;
}

/**
 * A conversation's stored messages split into what came before and what is
 * still to be answered: everything they sent after the last reply (the
 * bot's or the salon's). Nothing to answer when the last word is not theirs.
 */
export function splitPending<T extends ChatRow>(rows: T[]): { earlier: T[]; pending: T[] } {
  let i = rows.length;
  while (i > 0 && rows[i - 1].role === "user") i--;
  return { earlier: rows.slice(0, i), pending: rows.slice(i) };
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
