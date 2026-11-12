/**
 * What the Conversations page shows beside a chat: who the person is (their
 * next visit, notes, recent visits, who they book for), a message Kikai took
 * that is still waiting, what happened during the chat (bookings made,
 * messages taken) to mark in the thread, and the photos they sent.
 *
 * A "client" is the chat's lead once they have a booking that was not
 * cancelled; until then they are someone new, and the panel says what Kikai
 * knows instead.
 */

import { prisma } from "@/lib/prisma";
import { photosByMessage } from "@/lib/thread-photos";

/** Visits listed under "Recent visits". */
const RECENT_MAX = 3;

export interface ClientVisit {
  id: string;
  bookingNumber: number | null;
  startsAt: Date;
  durationMinutes: number;
  serviceText: string;
  stylistName: string;
  amountMinor: number | null;
}

export interface ConversationClient {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isClient: boolean;
  /** Visits so far: past bookings that were not cancelled. */
  visits: number;
  /** `day` is its date in the salon's time zone, for opening the diary on it. */
  next: (ClientVisit & { photos: number; bookedInChat: boolean; day: string }) | null;
  recent: ClientVisit[];
  /** People booked through this person's number (a child on a parent's phone). */
  booksFor: { id: string; name: string | null }[];
  /** A message Kikai took that nobody has dealt with yet. */
  waiting: { id: string; message: string | null; createdAt: Date } | null;
}

export type ThreadEvent =
  | { kind: "booked"; at: Date; serviceText: string; startsAt: Date; bookingNumber: number | null }
  | { kind: "message"; at: Date };

export interface ConversationExtras {
  client: ConversationClient | null;
  events: ThreadEvent[];
  /** Message id → ids of the photos it carried. */
  photos: Record<string, string[]>;
}

const VISIT_SELECT = {
  id: true,
  bookingNumber: true,
  startsAt: true,
  durationMinutes: true,
  serviceText: true,
  stylistName: true,
  amountMinor: true,
  createdAt: true,
} as const;

export async function conversationExtras(p: {
  organizationId: string;
  channel: string;
  conversationId: string;
  conversationStartedAt: Date;
  leadId: string | null;
  messages: { id: string; role: string; content: string; createdAt: Date }[];
  timeZone: string;
  now?: Date;
}): Promise<ConversationExtras> {
  const now = p.now ?? new Date();
  const photoRows =
    p.channel === "website"
      ? []
      : await prisma.chatPhoto.findMany({
          where: { organizationId: p.organizationId, channel: p.channel, conversationId: p.conversationId },
          select: { id: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        });
  const photos = photosByMessage(p.messages, photoRows);

  if (!p.leadId) return { client: null, events: [], photos };

  const leadId = p.leadId;
  const [lead, next, recent, visits, made, callbacks] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: leadId, organizationId: p.organizationId, anonymisedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        notes: true,
        dependents: { select: { id: true, name: true }, where: { anonymisedAt: null } },
      },
    }),
    prisma.appointment.findFirst({
      where: { organizationId: p.organizationId, leadId, status: "booked", startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      select: { ...VISIT_SELECT, _count: { select: { photos: true } } },
    }),
    prisma.appointment.findMany({
      where: {
        organizationId: p.organizationId,
        leadId,
        status: { in: ["booked", "completed"] },
        startsAt: { lt: now },
      },
      orderBy: { startsAt: "desc" },
      take: RECENT_MAX,
      select: VISIT_SELECT,
    }),
    prisma.appointment.count({
      where: {
        organizationId: p.organizationId,
        leadId,
        status: { in: ["booked", "completed"] },
        startsAt: { lt: now },
      },
    }),
    // Bookings made while this chat was going, to mark in the thread.
    prisma.appointment.findMany({
      where: {
        organizationId: p.organizationId,
        leadId,
        status: { not: "cancelled" },
        createdAt: { gte: p.conversationStartedAt },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, serviceText: true, startsAt: true, bookingNumber: true },
    }),
    prisma.callback.findMany({
      where: { organizationId: p.organizationId, leadId, createdAt: { gte: p.conversationStartedAt } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, status: true, notes: true },
    }),
  ]);

  const events: ThreadEvent[] = [
    ...made.map((a) => ({
      kind: "booked" as const,
      at: a.createdAt,
      serviceText: a.serviceText,
      startsAt: a.startsAt,
      bookingNumber: a.bookingNumber,
    })),
    ...callbacks.map((c) => ({ kind: "message" as const, at: c.createdAt })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  if (!lead) return { client: null, events, photos };

  // The newest pending one from this chat; an older one from before it is
  // the Callbacks page's business, not this conversation's.
  const pending = [...callbacks].reverse().find((c) => c.status === "pending");
  const strip = <T extends { createdAt: Date }>(v: T) => {
    const { createdAt: _createdAt, ...rest } = v;
    void _createdAt;
    return rest;
  };

  return {
    client: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      notes: lead.notes,
      isClient: Boolean(next) || visits > 0,
      visits,
      next: next
        ? (() => {
            const { _count, ...visit } = strip(next);
            return {
              ...visit,
              photos: _count.photos,
              bookedInChat: made.some((m) => m.id === next.id),
              day: new Intl.DateTimeFormat("en-CA", { timeZone: p.timeZone }).format(next.startsAt),
            };
          })()
        : null,
      recent: recent.map(strip),
      booksFor: lead.dependents,
      waiting: pending ? { id: pending.id, message: pending.notes, createdAt: pending.createdAt } : null,
    },
    events,
    photos,
  };
}
