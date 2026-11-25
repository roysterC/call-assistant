/**
 * Two client cards for one person, made one: what the salon does with a
 * card marked "possible duplicate" (client-identity.ts), or any two it
 * knows are the same.
 *
 * Everything on the duplicate moves to the card kept: bookings, calls,
 * callbacks, chats, rebook texts, anyone reached through its number, and
 * any card marked as possibly it. The card kept keeps what it has, and takes
 * from the duplicate only what it is missing (name, number, email, company,
 * what they want); notes are joined; the later patch test counts; and if
 * either asked for no rebooking texts, none are sent. The duplicate is then
 * deleted: nothing of it is lost, and nothing is left to open.
 *
 * `notADuplicate` is the other answer: not the same person, so the mark is
 * cleared and both cards stay as they are.
 */

import { prisma } from "@/lib/prisma";

export type MergeResult =
  | { ok: true; into: string; moved: { appointments: number; callbacks: number; calls: number; chats: number } }
  | { ok: false; status: 400 | 404; message: string };

export async function mergeClients(organizationId: string, fromId: string, intoId: string): Promise<MergeResult> {
  if (fromId === intoId) return { ok: false, status: 400, message: "Those are the same client." };
  return prisma.$transaction(
    async (tx) => {
      const live = { organizationId, anonymisedAt: null };
      const [from, into] = await Promise.all([
        tx.lead.findFirst({ where: { id: fromId, ...live } }),
        tx.lead.findFirst({ where: { id: intoId, ...live } }),
      ]);
      if (!from || !into) return { ok: false as const, status: 404 as const, message: "That client was not found." };

      const where = { organizationId, leadId: fromId };
      const moved = { leadId: intoId };
      const appointments = await tx.appointment.updateMany({ where, data: moved });
      const callbacks = await tx.callback.updateMany({ where, data: moved });
      const calls = await tx.call.updateMany({ where, data: moved });
      await tx.rebookText.updateMany({ where, data: moved });
      const chats =
        (await tx.whatsAppConversation.updateMany({ where, data: moved })).count +
        (await tx.websiteConversation.updateMany({ where, data: moved })).count +
        (await tx.socialConversation.updateMany({ where, data: moved })).count;

      // Reached through the duplicate's number: now through the kept card's.
      // The kept card itself is never reached through itself.
      await tx.lead.updateMany({
        where: { organizationId, contactLeadId: fromId, id: { not: intoId } },
        data: { contactLeadId: intoId },
      });
      // Cards marked as possibly the duplicate are possibly the kept card;
      // the kept card's own mark, if it was this one, is answered.
      await tx.lead.updateMany({
        where: { organizationId, possibleDuplicateOfId: fromId, id: { not: intoId } },
        data: { possibleDuplicateOfId: intoId },
      });

      const notes = [into.notes, from.notes].filter((n) => n?.trim()).join("\n\n") || null;
      // Whose number the kept card is reached through, if anyone's: its own
      // link (unless that was the duplicate, now itself); else, with no
      // number of its own after the merge, the duplicate's link.
      const notSelf = (id: string | null) => (id === intoId || id === fromId ? null : id);
      const contactLeadId =
        notSelf(into.contactLeadId) ?? (into.phone || from.phone ? null : notSelf(from.contactLeadId));
      const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));

      // The duplicate goes first: nothing then points at it.
      await tx.lead.delete({ where: { id: fromId } });
      await tx.lead.update({
        where: { id: intoId },
        data: {
          ...(!into.name?.trim() && from.name?.trim() ? { name: from.name } : {}),
          ...(!into.phone && from.phone ? { phone: from.phone } : {}),
          ...(!into.email && from.email ? { email: from.email } : {}),
          ...(!into.company && from.company ? { company: from.company } : {}),
          ...(!into.issue && from.issue ? { issue: from.issue } : {}),
          ...(notes !== into.notes ? { notes } : {}),
          patchTestAt: later(into.patchTestAt, from.patchTestAt),
          rebookTextsOff: into.rebookTextsOff || from.rebookTextsOff,
          contactLeadId,
          ...(into.possibleDuplicateOfId === fromId ? { possibleDuplicateOfId: null } : {}),
        },
      });

      return {
        ok: true as const,
        into: intoId,
        moved: { appointments: appointments.count, callbacks: callbacks.count, calls: calls.count, chats },
      };
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}

/** Not the same person: the mark comes off, and both cards stay. */
export async function notADuplicate(organizationId: string, id: string): Promise<boolean> {
  const r = await prisma.lead.updateMany({
    where: { id, organizationId, anonymisedAt: null },
    data: { possibleDuplicateOfId: null },
  });
  return r.count > 0;
}
