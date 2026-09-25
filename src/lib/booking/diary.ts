/**
 * Putting an appointment in the diary, and moving one.
 *
 * On a Google diary a booking is two writes: the calendar event, then our
 * record of it. On our own (native) diary the record IS the booking, so the
 * check that the chair is free and the insert that takes it must happen as
 * one step — otherwise two callers offered the same 2pm can both be told yes.
 *
 * That step holds a transaction-scoped advisory lock on the stylist for the
 * length of check-and-write. Two bookings for different stylists never wait
 * on each other; two for the same stylist queue, and the second one sees the
 * first one's row. This is stricter than the Google path, whose free/busy
 * check and insert are separate requests.
 *
 * Blocked time (lunch, holidays, closures) is checked in the same step, on
 * either diary: a phone booking into a block is refused exactly like one into
 * another booking. The desk may book into either, as it may overbook.
 */

import { prisma } from "@/lib/prisma";
import {
  insertNumberedAppointment,
  type NewAppointment,
  type Tx,
} from "@/lib/booking-number";
import type { Prisma } from "@/generated/prisma/client";
import { parseTimezone } from "@/lib/business-hours";
import {
  blockApplies,
  expandBlocks,
  type BlockOccurrence,
} from "@/lib/time-blocks";
import type { BusyBlock } from "./availability";
import type { BookingWrite, WritableProvider } from "./types";

/** Statuses that hold a chair. Cancelled and no-show time is free again. */
export const OCCUPYING_STATUSES = ["booked", "completed"];

/** Serialise every check-and-write for one stylist at one salon. */
async function lockStylist(tx: Tx, organizationId: string, stylistName: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${stylistName.toLowerCase()}))`;
}

/** The first appointment holding `stylistName`'s chair within [start, end). */
export async function findClash(
  db: Tx | typeof prisma,
  organizationId: string,
  stylistName: string,
  start: Date,
  end: Date,
  excludeId?: string
) {
  return db.appointment.findFirst({
    where: {
      organizationId,
      stylistName: { equals: stylistName, mode: "insensitive" },
      status: { in: OCCUPYING_STATUSES },
      startsAt: { lt: end },
      endsAt: { gt: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, startsAt: true, endsAt: true, serviceText: true },
  });
}

/**
 * Every stretch of blocked time overlapping [from, to), for anyone.
 *
 * Weekly blocks are read whole and expanded here; a salon has a handful, and
 * filtering the rule in SQL would mean re-implementing the expansion there.
 */
export async function blocksBetween(
  db: Tx | typeof prisma,
  organizationId: string,
  from: Date,
  to: Date,
  timeZone: string
): Promise<BlockOccurrence[]> {
  const rows = await db.timeBlock.findMany({
    where: {
      organizationId,
      OR: [{ repeat: "weekly" }, { startsAt: { lt: to }, endsAt: { gt: from } }],
    },
  });
  return expandBlocks(rows, from, to, timeZone);
}

async function salonTimeZone(db: Tx | typeof prisma, organizationId: string) {
  const settings = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { timezone: true },
  });
  return parseTimezone(settings?.timezone);
}

/** The first block keeping `stylistName` out of [start, end), if any. */
export async function findBlockClash(
  db: Tx | typeof prisma,
  organizationId: string,
  stylistName: string,
  start: Date,
  end: Date
): Promise<BlockOccurrence | null> {
  const timeZone = await salonTimeZone(db, organizationId);
  const blocks = await blocksBetween(db, organizationId, start, end, timeZone);
  return blocks.find((b) => blockApplies(b, stylistName)) ?? null;
}

/** Busy time per stylist (keyed lower-case) from our own appointments. */
export async function busyFromDiary(
  organizationId: string,
  stylistNames: string[],
  from: Date,
  to: Date
): Promise<Map<string, BusyBlock[]>> {
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId,
      status: { in: OCCUPYING_STATUSES },
      startsAt: { lt: to },
      endsAt: { gt: from },
      OR: stylistNames.map((name) => ({
        stylistName: { equals: name, mode: "insensitive" as const },
      })),
    },
    select: { stylistName: true, startsAt: true, endsAt: true },
  });
  const out = new Map<string, BusyBlock[]>();
  for (const r of rows) {
    const key = r.stylistName.toLowerCase();
    const list = out.get(key) ?? [];
    list.push({ start: r.startsAt, end: r.endsAt });
    out.set(key, list);
  }
  return out;
}

class SlotTaken extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const TAKEN = "That time was taken while we were talking.";

/**
 * Why a block refused a booking, as the phone agent will say it. The label is
 * left out on purpose: it is written for staff ("Doctor's appointment") and
 * the agent would read it to the caller.
 */
function blockedReason(stylistName: string, block: BlockOccurrence): string {
  return block.stylistName === null
    ? "The salon is closed then."
    : `${stylistName} is not available then.`;
}

/** Everything about an appointment except where the diary put it. */
export type AppointmentRecord = Omit<
  NewAppointment,
  "startsAt" | "endsAt" | "googleEventId" | "googleCalendarId"
>;

export type DiaryResult<T> =
  | { ok: true; appointment: T }
  | { ok: false; reason: string; conflict?: boolean };

/**
 * Book `write` into the diary and record it as `record`.
 *
 * The result is the same whichever diary the salon is on, so callers do not
 * branch: ok means the chair is taken and the appointment is numbered.
 */
export async function bookAppointment(
  provider: WritableProvider,
  write: BookingWrite,
  record: AppointmentRecord
): Promise<DiaryResult<Awaited<ReturnType<typeof insertNumberedAppointment>>>> {
  const startsAt = new Date(write.startsAt);
  const endsAt = new Date(startsAt.getTime() + write.durationMinutes * 60_000);

  if (provider.id === "native") {
    try {
      const appointment = await prisma.$transaction(async (tx) => {
        await lockStylist(tx, write.organizationId, write.stylistName);
        // A desk overbook is a decision made looking at the diary; a caller
        // cannot see it, so the phone never gets one.
        if (!write.allowOverlap) {
          const clash = await findClash(
            tx,
            write.organizationId,
            write.stylistName,
            startsAt,
            endsAt
          );
          if (clash) throw new SlotTaken(TAKEN);
          const block = await findBlockClash(
            tx,
            write.organizationId,
            write.stylistName,
            startsAt,
            endsAt
          );
          if (block) throw new SlotTaken(blockedReason(write.stylistName, block));
        }
        return insertNumberedAppointment(tx, { ...record, startsAt, endsAt });
      });
      return { ok: true, appointment };
    } catch (err) {
      if (err instanceof SlotTaken) return { ok: false, conflict: true, reason: err.reason };
      throw err;
    }
  }

  // Google has no idea about our blocks, so they are checked before it is
  // asked to write.
  if (!write.allowOverlap) {
    const block = await findBlockClash(
      prisma,
      write.organizationId,
      write.stylistName,
      startsAt,
      endsAt
    );
    if (block) {
      return { ok: false, conflict: true, reason: blockedReason(write.stylistName, block) };
    }
  }

  const written = await provider.createBooking(write);
  if (!written.ok) return written;
  const appointment = await prisma.$transaction((tx) =>
    insertNumberedAppointment(tx, {
      ...record,
      startsAt: new Date(written.startsAt),
      endsAt: new Date(written.endsAt),
      googleEventId: written.ref,
      googleCalendarId: written.calendarId ?? null,
    })
  );
  return { ok: true, appointment };
}

/**
 * Move an appointment on the native diary: check the new time is free of
 * everyone else's bookings (not of its own old slot, which it is leaving)
 * and move it, as one step under the same lock a booking takes.
 */
export async function moveInNativeDiary(
  appointmentId: string,
  organizationId: string,
  move: { startsAt: Date; durationMinutes: number; stylistName: string },
  /** Anything else to change on the appointment in the same write. */
  data: Prisma.AppointmentUncheckedUpdateInput = {}
): Promise<DiaryResult<{ id: string; startsAt: Date; endsAt: Date }>> {
  const endsAt = new Date(move.startsAt.getTime() + move.durationMinutes * 60_000);
  try {
    const appointment = await prisma.$transaction(async (tx) => {
      await lockStylist(tx, organizationId, move.stylistName);
      const clash = await findClash(
        tx,
        organizationId,
        move.stylistName,
        move.startsAt,
        endsAt,
        appointmentId
      );
      if (clash) throw new SlotTaken(TAKEN);
      const block = await findBlockClash(
        tx,
        organizationId,
        move.stylistName,
        move.startsAt,
        endsAt
      );
      if (block) throw new SlotTaken(blockedReason(move.stylistName, block));
      return tx.appointment.update({
        where: { id: appointmentId },
        data: {
          ...data,
          startsAt: move.startsAt,
          endsAt,
          stylistName: move.stylistName,
          durationMinutes: move.durationMinutes,
        },
        select: { id: true, startsAt: true, endsAt: true },
      });
    });
    return { ok: true, appointment };
  } catch (err) {
    if (err instanceof SlotTaken) return { ok: false, conflict: true, reason: err.reason };
    throw err;
  }
}
