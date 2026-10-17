/**
 * WhatsApp Cloud API: sending and read receipts. Each salon sends from its
 * own number with its own token (whatsappSender in meta-credentials.ts);
 * webhook signatures are checked there too.
 */

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

/** The salon's number (Meta's phone number id) and its token. */
export interface WhatsAppSender {
  phoneNumberId: string;
  accessToken: string;
}

export async function sendTextMessage(
  sender: WhatsAppSender,
  to: string,
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const truncatedBody =
    body.length > 4096 ? body.slice(0, 4093) + "..." : body;

  const url = `${GRAPH_API_BASE}/${sender.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sender.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: truncatedBody },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[WHATSAPP] Send message failed:", res.status, text);
    return { success: false, error: `WhatsApp API error ${res.status}: ${text}` };
  }

  const data = await res.json();
  return { success: true, messageId: data.messages?.[0]?.id };
}

export async function markAsRead(sender: WhatsAppSender, messageId: string): Promise<void> {
  const url = `${GRAPH_API_BASE}/${sender.phoneNumberId}/messages`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sender.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  }).catch((err) => console.error("[WHATSAPP] Mark-as-read failed:", err));
}

export function waIdToPhone(waId: string): string {
  return waId.startsWith("+") ? waId : `+${waId}`;
}
