/**
 * After a restart: answer chats whose last message is theirs and still
 * unanswered. The wait before a reply (chat-burst.ts) is held in memory, so a
 * restart during it, or while a reply was being written, would otherwise
 * leave someone waiting for good. Run once, shortly after the server starts
 * (instrumentation.ts).
 */

import { prisma } from "@/lib/prisma";
import { isHandled } from "@/lib/chat-burst";

/** Only recent ones: an old unanswered message is for the salon, not a late bot reply. */
export const RECOVER_WITHIN_MS = 10 * 60_000;

export async function answerUnansweredChats(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - RECOVER_WITHIN_MS);
  const [social, whatsapp] = await Promise.all([
    prisma.socialConversation.findMany({
      where: { lastMessageAt: { gte: since } },
      select: { id: true, channel: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true } } },
    }),
    prisma.whatsAppConversation.findMany({
      where: { lastMessageAt: { gte: since } },
      select: { id: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true } } },
    }),
  ]);

  const { answerSocialAfterRestart } = await import("@/lib/meta-messaging");
  const { answerWhatsAppAfterRestart } = await import("@/lib/whatsapp-reply");
  let n = 0;
  for (const c of social) {
    if (c.messages[0]?.role !== "user" || isHandled(`${c.channel}:${c.id}`)) continue;
    await answerSocialAfterRestart(c.id).catch((err) => console.error("[CHAT] Could not answer after restart:", err));
    n++;
  }
  for (const c of whatsapp) {
    if (c.messages[0]?.role !== "user" || isHandled(`whatsapp:${c.id}`)) continue;
    await answerWhatsAppAfterRestart(c.id).catch((err) => console.error("[CHAT] Could not answer after restart:", err));
    n++;
  }
  if (n) console.log(`[CHAT] Answering ${n} chat(s) left unanswered by a restart.`);
  return n;
}
