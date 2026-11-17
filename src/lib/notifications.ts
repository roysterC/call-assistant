/**
 * Everything waiting on a person at the salon, in one list: the bell's panel,
 * its count, the count in the browser tab and on the app's icon, and the
 * sound when something new arrives (src/lib/use-notifications.ts).
 *
 *   - New bookings the receptionist or the online booking page took, until
 *     this person closes the pop-up or opens the booking (booking-notices.ts).
 *   - Callbacks waiting: a message taken, a call back asked for, a booking
 *     the diary would not take.
 *   - Quotes waiting for a price.
 *
 * Bookings are each person's own to clear; callbacks and quotes are the
 * salon's, and stay until someone deals with them.
 */

import { prisma } from "@/lib/prisma";
import { openNotices } from "@/lib/booking-notices";
import { parseQuoteItems } from "@/lib/quote-text";
import { quoteUrl } from "@/lib/quotes";
import { getSalonConfig } from "@/lib/booking";
import { zonedDateString } from "@/lib/business-hours";

/** At most this many of each kind are listed; the counts are always whole. */
export const LISTED = 20;

export type NotificationKind = "booking" | "callback" | "quote";

export interface NotificationItem {
  /** Unique across kinds: what the sound remembers as heard. */
  key: string;
  kind: NotificationKind;
  /** The row it is about: a booking notice's, a callback's, a quote's. */
  id: string;
  /** When it arrived. */
  at: string;
  /** Who it is about. */
  name: string;
  /** booking: the service; callback: the message, or what they wanted; quote: the channel ("Instagram"). */
  detail: string;
  /** booking: when it is for, and with whom. */
  startsAt?: string;
  stylist?: string;
  /** callback: a booking the diary would not take, so ring them. */
  notBooked?: boolean;
  /** quote: how many designs. */
  designs?: number;
  /** Where it opens (without ?asOrg: the browser adds it). */
  href: string;
}

export interface Notifications {
  counts: Record<NotificationKind, number>;
  total: number;
  items: NotificationItem[];
  /** The salon's, for saying when a booking is. */
  timeZone: string;
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };

/** A callback's note as one line: what the message is, without the booking failure's working. */
export function callbackLine(notes: string | null): { line: string; notBooked: boolean } {
  const text = (notes ?? "").trim();
  if (text.startsWith("COULD NOT BOOK:")) {
    const wanted = text.split("\n").find((l) => l.startsWith("Wanted:"));
    return { line: wanted ? wanted.replace(/^Wanted:\s*/, "").replace(/ at \d{4}-\d{2}-\d{2}T.*$/, "") : "", notBooked: true };
  }
  const first = text.split("\n")[0] ?? "";
  return { line: first.length > 140 ? `${first.slice(0, 137)}…` : first, notBooked: false };
}

export async function notificationsFor(userId: string, organizationId: string): Promise<Notifications> {
  const [cfg, bookings, callbackRows, callbackCount, quoteRows, quoteCount] = await Promise.all([
    getSalonConfig(organizationId),
    openNotices(userId, organizationId, LISTED),
    prisma.callback.findMany({
      where: { organizationId, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: LISTED,
      select: {
        id: true,
        createdAt: true,
        notes: true,
        lead: { select: { name: true, phone: true, contactLead: { select: { name: true } } } },
      },
    }),
    prisma.callback.count({ where: { organizationId, status: "pending" } }),
    prisma.quote.findMany({
      where: { organizationId, status: "requested" },
      orderBy: { createdAt: "desc" },
      take: LISTED,
      select: { id: true, createdAt: true, clientName: true, channel: true, conversationId: true, items: true },
    }),
    prisma.quote.count({ where: { organizationId, status: "requested" } }),
  ]);

  const items: NotificationItem[] = [
    ...bookings.notices.map((n) => ({
      key: `booking:${n.id}`,
      kind: "booking" as const,
      id: n.id,
      at: n.createdAt,
      name: n.clientName,
      detail: n.serviceText,
      startsAt: n.startsAt,
      stylist: n.stylistName,
      href: `/calendar?date=${zonedDateString(new Date(n.startsAt), cfg.timeZone)}&booking=${encodeURIComponent(n.appointmentId)}`,
    })),
    ...callbackRows.map((c) => {
      const { line, notBooked } = callbackLine(c.notes);
      return {
        key: `callback:${c.id}`,
        kind: "callback" as const,
        id: c.id,
        at: c.createdAt.toISOString(),
        name: c.lead.name ?? c.lead.contactLead?.name ?? c.lead.phone ?? "A client",
        detail: line,
        notBooked,
        href: `/callbacks?c=${encodeURIComponent(c.id)}`,
      };
    }),
    ...quoteRows.map((q) => {
      const designs = parseQuoteItems(q.items).length;
      return {
        key: `quote:${q.id}`,
        kind: "quote" as const,
        id: q.id,
        at: q.createdAt.toISOString(),
        name: q.clientName ?? "A client",
        detail: CHANNEL_LABEL[q.channel] ?? q.channel,
        designs,
        href: quoteUrl(q.channel, q.conversationId),
      };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const counts = { booking: bookings.total, callback: callbackCount, quote: quoteCount };
  return { counts, total: counts.booking + counts.callback + counts.quote, items, timeZone: cfg.timeZone };
}
