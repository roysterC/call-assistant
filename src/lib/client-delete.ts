/**
 * Deleting a client: a duplicate, a test entry, or someone who has asked to
 * be forgotten.
 *
 * Who they were goes: name, number, email, notes, patch test, and the notes
 * on their bookings, which are often about them ("allergic to PPD"). Their
 * bookings themselves stay, with service, stylist, date and amount, so the
 * takings they paid are still in Sales; those show as "Deleted client". The
 * row is kept for the bookings to belong to and marked `anonymisedAt`, which
 * keeps it out of every list and stops it being opened or edited again.
 *
 * Their callbacks are deleted (a reminder to ring someone nobody can ring),
 * and the call log and message inbox are unlinked from them: those stay as
 * the salon's record of what came in.
 *
 * Refused, rather than half done, while:
 *  - they have bookings still to come. The diary would keep a slot for a
 *    client nobody can contact. Cancel or move them first.
 *  - someone books through their number (a child on a parent's phone).
 *    Those people would be left with no way to be texted.
 */

import { prisma } from "@/lib/prisma";

export type DeleteClientResult =
  | { ok: true; bookingsKept: number; callbacks: number }
  | { ok: false; status: number; message: string };

export async function deleteClient(organizationId: string, id: string): Promise<DeleteClientResult> {
  return prisma.$transaction(async (tx) => {
    const client = await tx.lead.findFirst({
      where: { id, organizationId, anonymisedAt: null },
      select: { id: true, dependents: { select: { name: true } } },
    });
    if (!client) return { ok: false, status: 404, message: "Not found" };

    if (client.dependents.length > 0) {
      const names = client.dependents.map((d) => d.name ?? "someone").join(", ");
      return {
        ok: false,
        status: 409,
        message: `${names} ${client.dependents.length === 1 ? "books" : "book"} through this client's number. Give them a number of their own first.`,
      };
    }

    const upcoming = await tx.appointment.count({
      where: { organizationId, leadId: id, status: "booked", startsAt: { gte: new Date() } },
    });
    if (upcoming > 0) {
      return {
        ok: false,
        status: 409,
        message:
          upcoming === 1
            ? "They have a booking coming up. Cancel or move it in the diary first."
            : `They have ${upcoming} bookings coming up. Cancel or move them in the diary first.`,
      };
    }

    const bookings = await tx.appointment.updateMany({
      where: { organizationId, leadId: id },
      data: { notes: null },
    });
    const callbacks = await tx.callback.deleteMany({ where: { organizationId, leadId: id } });
    const unlink = { where: { organizationId, leadId: id }, data: { leadId: null } };
    await tx.call.updateMany(unlink);
    await tx.whatsAppConversation.updateMany(unlink);
    await tx.websiteConversation.updateMany(unlink);
    await tx.socialConversation.updateMany(unlink);
    await tx.lead.update({
      where: { id },
      data: {
        name: null,
        firstName: null,
        lastName: null,
        email: null,
        phone: null,
        company: null,
        issue: null,
        notes: null,
        patchTestAt: null,
        contactLeadId: null,
        anonymisedAt: new Date(),
      },
    });
    return { ok: true, bookingsKept: bookings.count, callbacks: callbacks.count };
  });
}
