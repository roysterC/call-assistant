/**
 * Reading and checking time blocks against the database.
 *
 * The pure rules live in time-blocks.ts; this is the part that needs the
 * salon's appointments, shared by the create and edit endpoints.
 */

import { prisma } from "@/lib/prisma";
import {
  addCalendarDays,
  parseDateOnly,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import { expandBlocks, type TimeBlockData } from "@/lib/time-blocks";

/** How far ahead an open-ended weekly block is checked for clashing bookings. */
const OPEN_ENDED_LOOKAHEAD_DAYS = 84;

function startOfDay(date: string, timeZone: string): Date {
  const { year, month, day } = parseDateOnly(date);
  return zonedWallTimeToUtc(year, month, day, 0, 0, timeZone);
}

export interface AffectedBooking {
  id: string;
  bookingNumber: number | null;
  clientName: string | null;
  stylistName: string;
  serviceText: string;
  startsAt: Date;
}

/**
 * Upcoming bookings that fall inside a block, so the form can list them
 * before it is saved. They are not touched: the salon decides whether to move
 * them, which is why the block is allowed to be saved over them at all.
 *
 * An open-ended weekly block is checked twelve weeks ahead; past that, a
 * booking made later is refused by the phone and warned about at the desk.
 */
export async function bookingsInBlock(
  organizationId: string,
  data: TimeBlockData,
  timeZone: string,
  now = new Date()
): Promise<AffectedBooking[]> {
  let from: Date;
  let to: Date;
  if (data.repeat === "weekly") {
    if (!data.fromDate) return [];
    from = startOfDay(data.fromDate, timeZone);
    to = data.untilDate
      ? startOfDay(addCalendarDays(data.untilDate, 1), timeZone)
      : new Date(
          Math.max(now.getTime(), from.getTime()) +
            OPEN_ENDED_LOOKAHEAD_DAYS * 86_400_000
        );
  } else {
    if (!data.startsAt || !data.endsAt) return [];
    from = data.startsAt;
    to = data.endsAt;
  }
  if (from < now) from = now;
  if (to <= from) return [];

  const occurrences = expandBlocks([{ id: "new", ...data }], from, to, timeZone);
  if (occurrences.length === 0) return [];

  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: "booked",
      startsAt: { lt: to },
      endsAt: { gt: from },
      ...(data.stylistName
        ? { stylistName: { equals: data.stylistName, mode: "insensitive" as const } }
        : {}),
    },
    select: {
      id: true,
      bookingNumber: true,
      stylistName: true,
      serviceText: true,
      startsAt: true,
      endsAt: true,
      lead: { select: { name: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 200,
  });

  return rows
    .filter((r) => occurrences.some((o) => r.startsAt < o.end && r.endsAt > o.start))
    .map((r) => ({
      id: r.id,
      bookingNumber: r.bookingNumber,
      clientName: r.lead.name,
      stylistName: r.stylistName,
      serviceText: r.serviceText,
      startsAt: r.startsAt,
    }));
}
