/**
 * Quotes for nail designs: a client sends pictures of what they want and
 * asks the price, which only a technician can give.
 *
 *   1. The receptionist, in WhatsApp, Instagram or Messenger, files a quote
 *      request (request_quote) with every photo the client sent in the last
 *      day, one design each, instead of a call back, and tells the client
 *      the team will reply in the chat shortly.
 *   2. Everyone at the salon gets a push, and the chat sits in Needs you
 *      until it is answered.
 *   3. Whoever answers enters a price, and optionally a time, for each
 *      design, or marks one as not something the salon does.
 *   4. The reply (quote-text.ts) goes back in the same chat as the salon's
 *      own message, which the receptionist reads, so "the 2nd one,
 *      Saturday?" books at the quoted length. After the chat's 24-hour
 *      window has closed, Meta allows no reply there: it goes by text
 *      message instead, when they gave a number.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { pushToUsers } from "@/lib/push";
import { normalisePhone } from "@/lib/phone";
import { sendSms } from "@/lib/sms";
import { orgContextFor, sendText, type SocialChannel } from "@/lib/meta-messaging";
import { whatsappSender } from "@/lib/meta-credentials";
import { sendTextMessage } from "@/lib/whatsapp";
import { parseQuoteItems, quoteReady, quoteReply, type QuoteItem } from "@/lib/quote-text";

/** The chats a quote can come from: those that take photos. */
export const QUOTE_CHANNELS = ["whatsapp", "instagram", "facebook"] as const;
export type QuoteChannel = (typeof QUOTE_CHANNELS)[number];

export function isQuoteChannel(c: unknown): c is QuoteChannel {
  return typeof c === "string" && (QUOTE_CHANNELS as readonly string[]).includes(c);
}

/** Photos sent this long before the request go with it. */
export const QUOTE_PHOTO_WINDOW_MS = 24 * 60 * 60_000;

/** Meta lets a business message someone this long after their last message. */
export const CHAT_REPLY_WINDOW_MS = 24 * 60 * 60_000;

/** At most this many designs in one quote: a client sending a whole album is asked to pick. */
export const MAX_DESIGNS = 8;

const CHANNEL_LABEL: Record<QuoteChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Messenger",
};

/** Where a quote's push opens: the chat, with its quote. */
export function quoteUrl(channel: string, conversationId: string): string {
  return `/conversations?c=${encodeURIComponent(conversationId)}&ch=${encodeURIComponent(channel)}&quote=1`;
}

/**
 * The receptionist's request_quote: one quote per chat while it is waiting,
 * so a client who sends another picture adds to it rather than starting a
 * second. Returns what the receptionist is told.
 */
export async function requestQuote(p: {
  organizationId: string;
  channel: QuoteChannel;
  conversationId: string;
  customerName?: unknown;
  customerPhone?: unknown;
  request?: unknown;
  now?: Date;
}): Promise<Record<string, unknown>> {
  const now = p.now ?? new Date();
  const photos = await prisma.chatPhoto.findMany({
    where: {
      organizationId: p.organizationId,
      channel: p.channel,
      conversationId: p.conversationId,
      appointmentId: null,
      createdAt: { gte: new Date(now.getTime() - QUOTE_PHOTO_WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (photos.length === 0) {
    return {
      success: false,
      message:
        "No pictures of the design have come through in this chat. Ask them to send a picture of each design they want priced, then file the quote.",
    };
  }
  if (photos.length > MAX_DESIGNS) {
    return {
      success: false,
      message: `They have sent ${photos.length} pictures. Ask which ones (up to ${MAX_DESIGNS}) they would like priced; nothing has been sent yet.`,
    };
  }

  const name = typeof p.customerName === "string" && p.customerName.trim() ? p.customerName.trim().slice(0, 80) : null;
  const phone = typeof p.customerPhone === "string" ? normalisePhone(p.customerPhone) : null;
  const request = typeof p.request === "string" && p.request.trim() ? p.request.trim().slice(0, 500) : "A price for these designs";

  const open = await prisma.quote.findFirst({
    where: { organizationId: p.organizationId, channel: p.channel, conversationId: p.conversationId, status: "requested" },
  });
  const known = open ? parseQuoteItems(open.items) : [];
  const items: QuoteItem[] = [
    ...known,
    ...photos
      .filter((ph) => !known.some((k) => k.photoId === ph.id))
      .map((ph) => ({ photoId: ph.id, priceMinor: null, minutes: null, declined: false })),
  ];
  const data = {
    request,
    items: items as unknown as Prisma.InputJsonValue,
    ...(name ? { clientName: name } : {}),
    ...(phone?.ok ? { clientPhone: phone.e164 } : {}),
  };
  const quote = open
    ? await prisma.quote.update({ where: { id: open.id }, data })
    : await prisma.quote.create({
        data: { organizationId: p.organizationId, channel: p.channel, conversationId: p.conversationId, ...data },
      });

  await tellTheSalon(p.organizationId, {
    id: quote.id,
    channel: p.channel,
    conversationId: p.conversationId,
    clientName: quote.clientName,
    designs: items.length,
  });

  return {
    success: true,
    designs: items.length,
    message:
      `Sent ${items.length === 1 ? "the design" : `all ${items.length} designs`} to the team for a price. ` +
      "Tell them the team will reply here with a price shortly. Do not give or guess a price yourself.",
  };
}

/** A push to everyone at the salon. Never throws: the quote is filed either way. */
async function tellTheSalon(
  organizationId: string,
  q: { id: string; channel: QuoteChannel; conversationId: string; clientName: string | null; designs: number }
): Promise<void> {
  try {
    const users = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
    if (users.length === 0) return;
    await pushToUsers(
      users.map((u) => u.id),
      {
        title: `Quote needed: ${q.clientName ?? "a client"}`,
        body: `${q.designs} design${q.designs === 1 ? "" : "s"} on ${CHANNEL_LABEL[q.channel]}, waiting for a price`,
        url: quoteUrl(q.channel, q.conversationId),
        tag: `quote-${q.id}`,
      }
    );
  } catch (err) {
    console.error("[QUOTES] Could not tell the salon about a quote:", err);
  }
}

/** When the client last wrote in this chat, or null. */
async function lastClientMessageAt(channel: QuoteChannel, conversationId: string): Promise<Date | null> {
  const where = { conversationId, role: "user" };
  const row =
    channel === "whatsapp"
      ? await prisma.whatsAppMessage.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
      : await prisma.socialMessage.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return row?.createdAt ?? null;
}

export type SendQuoteResult =
  | { ok: true; via: "chat" | "sms"; text: string }
  | { ok: false; status: number; error: string };

/**
 * Answer a quote: save the prices, write the reply, and send it in the
 * chat, or by text once the chat's window has closed.
 */
export async function sendQuote(p: {
  organizationId: string;
  quoteId: string;
  items: unknown;
  /** Who priced it, as the client reads it: a first name, or null for "the team". */
  from: string | null;
  sentBy: string | null;
  now?: Date;
}): Promise<SendQuoteResult> {
  const now = p.now ?? new Date();
  const quote = await prisma.quote.findFirst({ where: { id: p.quoteId, organizationId: p.organizationId } });
  if (!quote || !isQuoteChannel(quote.channel)) return { ok: false, status: 404, error: "Not found" };
  if (quote.status !== "requested") return { ok: false, status: 409, error: "This quote has already been sent." };

  // The answers, matched to the quote's own designs by photo: nothing a
  // request adds or leaves out changes which pictures were asked about.
  const given = parseQuoteItems(p.items);
  const items = parseQuoteItems(quote.items).map((item) => {
    const g = given.find((x) => x.photoId === item.photoId);
    return g ? { ...item, priceMinor: g.declined ? null : g.priceMinor, minutes: g.declined ? null : g.minutes, declined: g.declined } : item;
  });
  if (!quoteReady(items)) {
    return { ok: false, status: 400, error: "Give each design a price, or mark it as not one you do." };
  }
  const text = quoteReply(items, p.from);
  const channel = quote.channel;

  const last = await lastClientMessageAt(channel, quote.conversationId);
  const inWindow = Boolean(last && now.getTime() - last.getTime() < CHAT_REPLY_WINDOW_MS);
  let via: "chat" | "sms";
  let externalId: string | undefined;
  if (inWindow) {
    const sent = await sendOnChannel(quote.organizationId, channel, quote.conversationId, text);
    if (!sent.ok) return { ok: false, status: 502, error: sent.error };
    via = "chat";
    externalId = sent.messageId;
  } else if (quote.clientPhone) {
    const sms = await sendSms(quote.organizationId, quote.clientPhone, text);
    if (!sms.ok) {
      return { ok: false, status: 502, error: `The chat's 24 hours have passed and the text did not send: ${sms.reason}.` };
    }
    via = "sms";
  } else {
    return {
      ok: false,
      status: 409,
      error: `It is more than 24 hours since ${quote.clientName ?? "they"} last wrote, so ${CHANNEL_LABEL[channel]} will not take a reply, and there is no number to text. Ring them, or wait for them to write again.`,
    };
  }

  // The salon's own message in the chat: the inbox shows it, and the
  // receptionist reads it as the team's, so it books at the quoted prices.
  const content = via === "sms" ? `${text}\n\n(Sent by text message: the chat's 24 hours had passed.)` : text;
  if (channel === "whatsapp") {
    await prisma.whatsAppMessage.create({
      data: { conversationId: quote.conversationId, role: "agent", content, ...(externalId ? { waMessageId: externalId } : {}) },
    });
    await prisma.whatsAppConversation.update({ where: { id: quote.conversationId }, data: { lastMessageAt: now } });
  } else {
    await prisma.socialMessage.create({
      data: { conversationId: quote.conversationId, role: "agent", content, ...(externalId ? { externalMessageId: externalId } : {}) },
    });
    await prisma.socialConversation.update({ where: { id: quote.conversationId }, data: { lastMessageAt: now } });
  }
  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      items: items as unknown as Prisma.InputJsonValue,
      status: "sent",
      sentAt: now,
      sentBy: p.sentBy,
      sentVia: via,
    },
  });
  return { ok: true, via, text };
}

async function sendOnChannel(
  organizationId: string,
  channel: QuoteChannel,
  conversationId: string,
  text: string
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }> {
  if (channel === "whatsapp") {
    const conversation = await prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { phoneNumber: true },
    });
    const number = await prisma.phoneNumber.findFirst({
      where: { organizationId, channel: "whatsapp", active: true },
      select: { whatsappPhoneNumberId: true },
    });
    const sender = number?.whatsappPhoneNumberId ? await whatsappSender(organizationId, number.whatsappPhoneNumberId) : null;
    if (!conversation || !sender) return { ok: false, error: "WhatsApp is not connected for this salon." };
    const r = await sendTextMessage(sender, conversation.phoneNumber, text);
    return r.success ? { ok: true, messageId: r.messageId } : { ok: false, error: `WhatsApp did not take it: ${r.error ?? "unknown error"}.` };
  }
  const conversation = await prisma.socialConversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { externalUserId: true },
  });
  const ctx = await orgContextFor(organizationId, channel as SocialChannel);
  if (!conversation || !ctx) return { ok: false, error: `${CHANNEL_LABEL[channel]} is not connected for this salon.` };
  const r = await sendText(ctx, channel as SocialChannel, conversation.externalUserId, text);
  return r.success
    ? { ok: true, messageId: r.messageId }
    : { ok: false, error: `${CHANNEL_LABEL[channel]} did not take it: ${r.error ?? "unknown error"}.` };
}
