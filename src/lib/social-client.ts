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
 * Now a chat has no client until the receptionist files something for them
 * (a booking, a message, a callback) or they give a number for a quote: it is
 * then filed under that client. A number typed in a chat proves nothing, so
 * it never finds a client on file by itself: a new one is made, marked as
 * possibly whoever has it, for the salon to merge (client-identity.ts). A
 * chat still filed under one of the old made-up clients moves to the real
 * one, taking anything on it along (social-placeholders.ts).
 */

import { prisma } from "@/lib/prisma";
import { newClientFromTyped } from "@/lib/client-identity";
import { normalisePhone } from "@/lib/phone";
import { absorbPlaceholder, isPlaceholderPhone, type PlaceholderDb } from "@/lib/social-placeholders";

export { isPlaceholderPhone };

/**
 * File a chat under the client something was filed under for them, or else a
 * new client with the number they gave. A chat already filed under a real
 * client keeps them: someone booking for their daughter is still the one in
 * the chat. Returns the client, or null when nothing was filed. Never
 * throws: the reply has gone either way.
 */
export async function linkSocialClient(p: {
  organizationId: string;
  channel: "instagram" | "facebook";
  conversation: { id: string; leadId: string | null; contactName: string | null };
  contact: { phone: string; name: string | null; leadId?: string } | null;
}): Promise<string | null> {
  if (!p.contact) return null;
  const phone = normalisePhone(p.contact.phone);
  if (!phone.ok && !p.contact.leadId) return null;
  try {
    const current = p.conversation.leadId
      ? await prisma.lead.findUnique({ where: { id: p.conversation.leadId }, select: { id: true, phone: true } })
      : null;
    if (current && !isPlaceholderPhone(current.phone)) return current.id;

    const filed = p.contact.leadId
      ? await prisma.lead.findFirst({ where: { id: p.contact.leadId, organizationId: p.organizationId }, select: { id: true } })
      : null;
    if (!filed && !phone.ok) return null;
    const lead =
      filed ??
      (await newClientFromTyped(prisma, p.organizationId, {
        name: p.contact.name?.trim() || p.conversation.contactName,
        phone: p.contact.phone,
        source: p.channel,
      }));

    await prisma.socialConversation.update({ where: { id: p.conversation.id }, data: { leadId: lead.id } });
    if (current) await absorbPlaceholder(prisma as unknown as PlaceholderDb, current.id, lead.id);
    return lead.id;
  } catch (err) {
    console.error("[SOCIAL] Could not file the chat under its client:", err);
    return null;
  }
}
