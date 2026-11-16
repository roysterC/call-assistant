/**
 * Who an Instagram or Messenger chat is with.
 *
 * Meta gives no number, only an id for the person on this page. Each first
 * message used to make a client with a made-up number from that id
 * ("instagram-17841…") and the profile name, so everyone who ever messaged
 * was in Clients, and someone who then booked with their real number became
 * a second client, with the chat still filed under the first: its panel
 * never showed the booking.
 *
 * Now a chat has no client until the person gives a number (to book, for a
 * quote, or for the salon to ring). It is then filed under the client with
 * that number, the same one a call or a WhatsApp from it reaches, made if
 * there is none. A chat still filed under one of the old made-up clients
 * moves to the real one, taking anything on it along (social-placeholders.ts).
 */

import { prisma } from "@/lib/prisma";
import { clientForBooking } from "@/lib/client-link";
import { normalisePhone } from "@/lib/phone";
import { absorbPlaceholder, isPlaceholderPhone, type PlaceholderDb } from "@/lib/social-placeholders";

export { isPlaceholderPhone };

/**
 * File a chat under the client with the number they gave, made if there is
 * none. A chat already filed under a real client keeps them: someone booking
 * for their daughter is still the one in the chat. Returns the client, or
 * null when nothing was filed. Never throws: the reply has gone either way.
 */
export async function linkSocialClient(p: {
  organizationId: string;
  channel: "instagram" | "facebook";
  conversation: { id: string; leadId: string | null; contactName: string | null };
  contact: { phone: string; name: string | null } | null;
}): Promise<string | null> {
  if (!p.contact) return null;
  const phone = normalisePhone(p.contact.phone);
  if (!phone.ok) return null;
  try {
    const current = p.conversation.leadId
      ? await prisma.lead.findUnique({ where: { id: p.conversation.leadId }, select: { id: true, phone: true } })
      : null;
    if (current && !isPlaceholderPhone(current.phone)) return current.id;

    // The name they gave picks the right person on a shared number. Without
    // one, the number's own client; the profile name only names a new one.
    const lead = p.contact.name?.trim()
      ? (await clientForBooking(p.organizationId, phone.e164, p.contact.name.trim(), p.channel)).lead
      : ((await prisma.lead.findUnique({
          where: { organizationId_phone: { organizationId: p.organizationId, phone: phone.e164 } },
        })) ??
        (await prisma.lead.create({
          data: { organizationId: p.organizationId, phone: phone.e164, name: p.conversation.contactName, source: p.channel },
        })));

    await prisma.socialConversation.update({ where: { id: p.conversation.id }, data: { leadId: lead.id } });
    if (current) await absorbPlaceholder(prisma as unknown as PlaceholderDb, current.id, lead.id);
    return lead.id;
  } catch (err) {
    console.error("[SOCIAL] Could not file the chat under its client:", err);
    return null;
  }
}
