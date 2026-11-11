/**
 * Replying on WhatsApp: whatever in a conversation is still unanswered, once
 * they have stopped sending (chat-burst.ts). The receptionist for a salon
 * using the diary (chat-booking.ts), the plain chat otherwise. Shared by the
 * webhook and the restart check (chat-recovery.ts).
 */

import { prisma } from "@/lib/prisma";
import { chatReply, splitPending } from "@/lib/chat-booking";
import { afterQuiet } from "@/lib/chat-burst";
import { buildChatContext, buildSystemPrompt, CHAT_UNAVAILABLE, getChatResponse } from "@/lib/claude";
import { markAsRead, sendTextMessage, type WhatsAppSender } from "@/lib/whatsapp";
import { whatsappSender } from "@/lib/meta-credentials";

export function replyWhenQuiet(organizationId: string, conversationId: string, sender: WhatsAppSender): void {
  afterQuiet(`whatsapp:${conversationId}`, () => answerWhatsApp(organizationId, conversationId, sender));
}

export async function answerWhatsApp(
  organizationId: string,
  conversationId: string,
  sender: WhatsAppSender
): Promise<void> {
  const conversation = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return;

  // Honour per-conversation persona reset: the admin can flip
  // personaResetAt to NOW() after changing the org's system prompt, so the
  // AI ignores history that referenced the old persona. Customer-facing
  // inbox still shows the full history — only this prompt-construction
  // path filters. NULL = no reset → feed all history (default).
  const rows = await prisma.whatsAppMessage.findMany({
    where: {
      conversationId,
      ...(conversation.personaResetAt ? { createdAt: { gte: conversation.personaResetAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true, waMessageId: true },
  });
  const { earlier, pending } = splitPending(rows);
  if (pending.length === 0) return;

  const booked = await chatReply({
    organizationId,
    channel: "whatsapp",
    conversationId,
    earlier,
    text: pending.map((m) => m.content).join("\n"),
    phone: conversation.phoneNumber,
    resetAt: conversation.personaResetAt,
  });

  const aiResponse =
    booked ??
    (await (async () => {
      const { messages: chatMessages, systemPrompt } = buildChatContext(rows, await buildSystemPrompt(organizationId));
      return getChatResponse(chatMessages, systemPrompt, {
        organizationId,
        channel: "whatsapp",
        allowCLI: true,
        // Let Claude extract issue / name / email / company onto the lead
        // when the customer shares them. Mirrors the phone receptionist.
        extractToLead: conversation.leadId ? { leadId: conversation.leadId } : undefined,
      }).catch((err) => {
        console.error("[WHATSAPP] Plain chat reply failed:", err);
        return CHAT_UNAVAILABLE;
      });
    })());

  const sendResult = await sendTextMessage(sender, conversation.waId, aiResponse);

  await prisma.whatsAppMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: aiResponse,
      waMessageId: sendResult.messageId,
      status: sendResult.success ? "sent" : "failed",
    },
  });

  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), isRead: false },
  });

  const last = pending[pending.length - 1].waMessageId;
  if (last) void markAsRead(sender, last).catch(() => {});
}

/** Answer a conversation found unanswered after a restart (chat-recovery.ts). */
export async function answerWhatsAppAfterRestart(conversationId: string): Promise<void> {
  const conversation = await prisma.whatsAppConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, organizationId: true },
  });
  if (!conversation) return;
  const number = await prisma.phoneNumber.findFirst({
    where: { organizationId: conversation.organizationId, channel: "whatsapp", active: true },
    select: { whatsappPhoneNumberId: true },
  });
  if (!number?.whatsappPhoneNumberId) return;
  const sender = await whatsappSender(conversation.organizationId, number.whatsappPhoneNumberId);
  if (!sender) return;
  afterQuiet(`whatsapp:${conversation.id}`, () => answerWhatsApp(conversation.organizationId, conversation.id, sender), {
    quietMs: 0,
  });
}
