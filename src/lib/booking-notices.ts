/**
 * Telling the salon about a booking the receptionist took.
 *
 * Everyone with a login at the salon gets a notice of their own
 * (BookingNotice). On a computer it is a pop-up in the corner that stays
 * until they close it or open the booking; in the diary the booking keeps a
 * colour of its own until they open it. On a phone or computer they turned
 * alerts on for, a push notification goes too (src/lib/push.ts).
 *
 * Only the receptionist's bookings: one made at the desk, or through the
 * personal assistant, was made by someone who already knows.
 */

import { prisma } from "@/lib/prisma";
import { describeAppointmentWhen, zonedDateString } from "@/lib/business-hours";
import { pushToUsers, type PushMessage } from "@/lib/push";

export interface NoticeBooking {
  id: string;
  bookingNumber: number | null;
  clientName: string;
  serviceText: string;
  stylistName: string;
  startsAt: Date;
}

/** Where a notice opens: the diary, on the booking's day, with it open. */
export function bookingUrl(appointmentId: string, startsAt: Date, timeZone: string): string {
  return `/calendar?date=${zonedDateString(startsAt, timeZone)}&booking=${encodeURIComponent(appointmentId)}`;
}

/** The push notification for a new booking, as the lock screen shows it. */
export function bookingPush(b: NoticeBooking, timeZone: string, now: Date = new Date()): PushMessage {
  return {
    title: `New booking: ${b.clientName}`,
    body: `${b.serviceText} with ${b.stylistName}, ${describeAppointmentWhen(b.startsAt, timeZone, now)}`,
    url: bookingUrl(b.id, b.startsAt, timeZone),
    tag: `booking-${b.id}`,
  };
}

/**
 * A notice for everyone at the salon, and a push to their devices. Never
 * throws: the booking is made and the caller has been told so; a notice that
 * fails is logged, not passed back to the call.
 */
export async function noticeNewBooking(organizationId: string, booking: NoticeBooking, timeZone: string): Promise<void> {
  try {
    const users = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
    if (users.length === 0) return;
    const userIds = users.map((u) => u.id);
    await prisma.bookingNotice.createMany({
      data: userIds.map((userId) => ({ organizationId, userId, appointmentId: booking.id })),
      skipDuplicates: true,
    });
    await pushToUsers(userIds, bookingPush(booking, timeZone));
  } catch (err) {
    console.error("[BOOKING NOTICES] Could not tell the salon about a booking:", err);
  }
}

/** How many open notices a pop-up stack shows before "and N more". */
const SHOWN = 3;

/** The pop-ups this person has not closed yet, newest first. */
export async function openNotices(userId: string, organizationId: string) {
  const where = { userId, organizationId, dismissedAt: null };
  const [rows, total] = await Promise.all([
    prisma.bookingNotice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: SHOWN,
      select: {
        id: true,
        createdAt: true,
        appointment: {
          select: {
            id: true,
            bookingNumber: true,
            serviceText: true,
            stylistName: true,
            startsAt: true,
            status: true,
            lead: { select: { name: true } },
          },
        },
      },
    }),
    prisma.bookingNotice.count({ where }),
  ]);
  return {
    total,
    notices: rows.map((n) => ({
      id: n.id,
      createdAt: n.createdAt.toISOString(),
      appointmentId: n.appointment.id,
      bookingNumber: n.appointment.bookingNumber,
      clientName: n.appointment.lead.name ?? "A client",
      serviceText: n.appointment.serviceText,
      stylistName: n.appointment.stylistName,
      startsAt: n.appointment.startsAt.toISOString(),
      status: n.appointment.status,
    })),
  };
}

/** Closed: the pop-up goes, the diary colour stays until the booking is opened. */
export async function dismissNotices(userId: string, organizationId: string, noticeId?: string): Promise<void> {
  await prisma.bookingNotice.updateMany({
    where: { userId, organizationId, dismissedAt: null, ...(noticeId ? { id: noticeId } : {}) },
    data: { dismissedAt: new Date() },
  });
}

/** The booking was opened: both go. */
export async function markBookingSeen(userId: string, organizationId: string, appointmentId: string): Promise<void> {
  const now = new Date();
  await prisma.bookingNotice.updateMany({
    where: { userId, organizationId, appointmentId, seenAt: null },
    data: { seenAt: now },
  });
  await prisma.bookingNotice.updateMany({
    where: { userId, organizationId, appointmentId, dismissedAt: null },
    data: { dismissedAt: now },
  });
}

/** Which of these bookings this person has not opened yet. */
export async function unseenBookingIds(userId: string, appointmentIds: string[]): Promise<Set<string>> {
  if (appointmentIds.length === 0) return new Set();
  const rows = await prisma.bookingNotice.findMany({
    where: { userId, appointmentId: { in: appointmentIds }, seenAt: null },
    select: { appointmentId: true },
  });
  return new Set(rows.map((r) => r.appointmentId));
}
