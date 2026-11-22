/**
 * Where a caller can send a photo of a design to have it quoted.
 *
 * A particular design is priced from a photo, and the phone has no way to
 * take one: the salon's messages do (WhatsApp, Instagram, Messenger, where the
 * team, or the chat booking, quote it: lib/quotes.ts). So on the phone the
 * receptionist sends a caller with a design there, rather than taking a
 * message for a call back that can't price it either.
 */

import { prisma } from "@/lib/prisma";
import { VOICE_CHANNEL, WHATSAPP_CHANNEL } from "@/lib/phone-channels";
import { orList } from "@/lib/business-types";

export interface DesignChats {
  /** The WhatsApp number, and whether it is the number they rang. */
  whatsapp: { number: string; sameAsLine: boolean } | null;
  /** The Instagram @username, without the @. */
  instagram: string | null;
  /** Messenger: the page has no name stored, so just "our Facebook page". */
  facebook: boolean;
}

export async function designChatsFor(organizationId: string): Promise<DesignChats | null> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { whatsappEnabled: true, instagramEnabled: true, instagramUsername: true, facebookEnabled: true },
  });
  if (!settings) return null;
  const numbers = settings.whatsappEnabled
    ? await prisma.phoneNumber.findMany({
        where: { organizationId, active: true, channel: { in: [WHATSAPP_CHANNEL, VOICE_CHANNEL] } },
        select: { channel: true, number: true },
      })
    : [];
  const wa = numbers.find((n) => n.channel === WHATSAPP_CHANNEL);
  const line = numbers.find((n) => n.channel === VOICE_CHANNEL);
  const chats: DesignChats = {
    whatsapp: wa ? { number: wa.number, sameAsLine: wa.number === line?.number } : null,
    instagram: settings.instagramEnabled ? settings.instagramUsername?.replace(/^@/, "").trim() || null : null,
    facebook: settings.facebookEnabled,
  };
  return chats.whatsapp || chats.instagram || chats.facebook ? chats : null;
}

/** The phone rule, or null when the salon takes messages nowhere. */
export function designRule(chats: DesignChats | null): string | null {
  if (!chats) return null;
  const where: string[] = [];
  if (chats.whatsapp) where.push(chats.whatsapp.sameAsLine ? "WhatsApp (this same number)" : `WhatsApp (${chats.whatsapp.number})`);
  if (chats.instagram) where.push(`Instagram (@${chats.instagram})`);
  if (chats.facebook) where.push("our Facebook page");
  const example = chats.instagram
    ? `*"Send a photo of it to our Instagram, at ${spokenHandle(chats.instagram)}, and we'll quote it there."*`
    : chats.whatsapp?.sameAsLine
      ? `*"Send a photo of it on WhatsApp to this number, and we'll quote it there."*`
      : chats.whatsapp
        ? `*"Send a photo of it to our WhatsApp, and we'll quote it there."* Then give the number.`
        : `*"Send a photo of it to our Facebook page, and we'll quote it there."*`;
  return [
    `# Designs`,
    ``,
    `A particular design is priced from a photo, and photos come by message, not`,
    `over the phone. The salon quotes designs on ${orList(where)}.`,
    ``,
    `- When a caller wants a specific design, or asks what one would cost or how`,
    `  to show it, tell them to send a photo of it there, and the team will reply`,
    `  with a price and how long it takes. One sentence, for example:`,
    `  ${example}`,
    `- Say an Instagram name as it is spelt, with "dot" and "underscore" said`,
    `  aloud. Read a number in small groups.`,
    `- Do not take a message for a design quote, and never guess its price. If`,
    `  they would still rather be rung back, take a message as usual.`,
    `- If they want a time held now anyway, book the treatment as usual, and say`,
    `  the design is priced once they have sent it.`,
  ].join("\n");
}

/** "shogo.nails" as it is said: "shogo dot nails". */
function spokenHandle(handle: string): string {
  return handle.replace(/\./g, " dot ").replace(/_/g, " underscore ").replace(/\s+/g, " ").trim();
}
