/**
 * Deleting a client: a duplicate, a test entry, or someone who has asked to
 * be forgotten.
 *
 * What goes with them: their bookings (and so their place in past takings)
 * and their callbacks, which cannot exist without a client. What stays: the
 * salon's call log and message inbox, unlinked from them, since those are
 * the salon's record of what came in rather than the client's record. The
 * database does that unlinking itself (those links are ON DELETE SET NULL).
 *
 * Refused, rather than half done, while:
 *  - they have bookings still to come. Deleting would empty a slot in the
 *    diary without anyone telling the client. Cancel or move them first.
 *  - someone books through their number (a child on a parent's phone).
 *    Those people would be left with no way to be texted.
 */

import { prisma } from "@/lib/prisma";

export type DeleteClientResult =
  | { ok: true; bookings: number; callbacks: number }
  | { ok: false; status: number; message: string };

export async function deleteClient(organizationId: string, id: string): Promise<DeleteClientResult> {
  return prisma.$transaction(async (tx) => {
    const client = await tx.lead.findFirst({
      where: { id, organizationId },
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

    // Their booking alerts go with the bookings (ON DELETE CASCADE).
    const bookings = await tx.appointment.deleteMany({ where: { organizationId, leadId: id } });
    const callbacks = await tx.callback.deleteMany({ where: { organizationId, leadId: id } });
    await tx.lead.delete({ where: { id } });
    return { ok: true, bookings: bookings.count, callbacks: callbacks.count };
  });
}
