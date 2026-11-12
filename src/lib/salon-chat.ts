/**
 * The chat on a salon's own page (/s/<slug>): one of its Websites chats,
 * chosen in Settings › Website & online booking (siteChatSiteId), shown with
 * public/widget.js, its button opening the salon's online booking.
 *
 * Only while website chat is on for the salon (chatbotEnabled, which Kikai
 * switches on) and the chosen chat is the salon's own and switched on.
 */

import { prisma } from "@/lib/prisma";

/** The chat to show on the salon's page, or null for none. */
export async function salonChatSiteId(organizationId: string): Promise<string | null> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { chatbotEnabled: true, siteChatSiteId: true },
  });
  if (!settings?.chatbotEnabled || !settings.siteChatSiteId) return null;
  const site = await prisma.websiteConfig.findFirst({
    where: { siteId: settings.siteChatSiteId, organizationId, enabled: true },
    select: { siteId: true },
  });
  return site?.siteId ?? null;
}

/** A chosen chat, checked as the salon's own before it is saved; null for none. */
export async function checkSiteChat(organizationId: string, value: unknown): Promise<string | null | "invalid"> {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const site = await prisma.websiteConfig.findFirst({
    where: { siteId: value, organizationId },
    select: { siteId: true },
  });
  return site ? site.siteId : "invalid";
}
