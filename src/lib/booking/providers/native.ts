/**
 * Our own diary: the appointments table is where the salon's day lives.
 *
 * Availability is read from the bookings we hold, so a stylist needs nothing
 * outside this system to be bookable, and a desk booking, a phone booking and
 * a cancellation are all visible to the next caller the moment they commit.
 * Nothing entered anywhere else (a stylist's personal calendar) is seen —
 * which is the point of the salon running its diary here.
 *
 * Writing is done by `bookAppointment` (../diary.ts), not by `createBooking`:
 * the booking is the appointment row, so the free-check and the insert have
 * to be one locked step. `createBooking` here only answers "is it still
 * free?" for the one caller that wants a diary check without a row — the
 * callback path, which records into its own table.
 */

import { prisma } from "@/lib/prisma";
import { blocksBetween, busyFromDiary, findClash } from "../diary";
import { readAvailability, type DiaryConfig, type LoadBusy } from "./shared";
import type {
  AvailabilityQuery,
  BookingProvider,
  BookingWrite,
  BookingWriteResult,
  TimeSlot,
} from "../types";

export function createNativeProvider(cfg: DiaryConfig): BookingProvider {
  const busyLoader =
    (organizationId: string): LoadBusy =>
    async (pool, from, to) => {
      const busy = await busyFromDiary(
        organizationId,
        pool.map((s) => s.name),
        from,
        to
      );
      return pool.map((stylist) => ({
        stylist,
        busy: busy.get(stylist.name.toLowerCase()) ?? [],
      }));
    };

  return {
    id: "native",

    capabilities: {
      readAvailability: true,
      createBooking: true,
      perStaffAvailability: true,
      // One query over the range, however wide.
      forwardSearch: true,
      // This is the diary itself, not a copy of one. The agent may confirm.
      availabilityIsAdvisory: false,
    },

    getAvailability(q: AvailabilityQuery): Promise<TimeSlot[]> {
      return readAvailability(
        cfg,
        q,
        busyLoader(q.organizationId),
        (from, to) => blocksBetween(prisma, q.organizationId, from, to, cfg.timeZone)
      );
    },

    async createBooking(r: BookingWrite): Promise<BookingWriteResult> {
      const start = new Date(r.startsAt);
      const end = new Date(start.getTime() + r.durationMinutes * 60_000);
      if (!r.allowOverlap) {
        const clash = await findClash(prisma, r.organizationId, r.stylistName, start, end);
        if (clash) {
          return { ok: false, conflict: true, reason: "That time is already booked." };
        }
      }
      // No external record exists, so there is no reference to return.
      return { ok: true, ref: "", startsAt: start.toISOString(), endsAt: end.toISOString() };
    },
  };
}
