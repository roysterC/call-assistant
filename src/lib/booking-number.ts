/**
 * Write an appointment with its booking number.
 *
 * The number comes from Organization.nextBookingNumber, bumped with an atomic
 * increment inside the same transaction as the insert. The increment takes a
 * row lock on the organization, so a desk booking and a phone booking saved in
 * the same instant queue for it rather than both reading 1043; and a failed
 * insert rolls the increment back, so a failure does not leave a gap.
 *
 * Every path that creates an appointment goes through here. One that did not
 * would write a booking with no number, which the diary would show as "—" and
 * nobody could quote back to the salon.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type NewAppointment = Omit<
  Prisma.AppointmentUncheckedCreateInput,
  "bookingNumber"
>;

/** The transaction client handed to a `prisma.$transaction` callback. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Number and insert inside a transaction the caller already holds. */
export async function insertNumberedAppointment(tx: Tx, data: NewAppointment) {
  const org = await tx.organization.update({
    where: { id: data.organizationId },
    data: { nextBookingNumber: { increment: 1 } },
    select: { nextBookingNumber: true },
  });
  return tx.appointment.create({
    data: { ...data, bookingNumber: org.nextBookingNumber - 1 },
    include: { lead: true },
  });
}

export async function createNumberedAppointment(data: NewAppointment) {
  return prisma.$transaction((tx) => insertNumberedAppointment(tx, data));
}
