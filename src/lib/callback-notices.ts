/**
 * Telling the salon about a callback the receptionist filed: a message for
 * them ("can someone ring me about my fringe?"), a call back asked for, or a
 * booking the diary would not take, which the caller was told the salon
 * would ring about.
 *
 * Bookings and quotes already sent a push; a callback only reached the
 * counter beside Callbacks in the menu, a minute later, for whoever had the
 * CRM open. Now everyone at the salon with alerts on gets one, and an open
 * CRM's counter and list update at once (the service worker tells the page).
 */

import { prisma } from "@/lib/prisma";
import { pushToUsers, type PushMessage } from "@/lib/push";

export type CallbackKind = "message" | "callback" | "not_booked";

export interface NoticeCallback {
  id: string;
  kind: CallbackKind;
  clientName: string | null;
  /** The callback's note: the message, what they want, or why it did not book. */
  notes: string | null;
}

const TITLES: Record<CallbackKind, string> = {
  message: "New message",
  callback: "Call back",
  not_booked: "Could not book: ring them",
};

/** The push for a new callback, as the lock screen shows it. */
export function callbackPush(c: NoticeCallback): PushMessage {
  const firstLine = (c.notes ?? "").split("\n")[0].trim();
  const body = firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
  return {
    title: `${TITLES[c.kind]}: ${c.clientName?.trim() || "a client"}`,
    body,
    url: "/callbacks",
    tag: `callback-${c.id}`,
    kind: "callback",
  };
}

/** A push to everyone at the salon. Never throws: the callback is filed either way. */
export async function noticeNewCallback(organizationId: string, c: NoticeCallback): Promise<void> {
  try {
    const users = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
    if (users.length === 0) return;
    await pushToUsers(
      users.map((u) => u.id),
      callbackPush(c)
    );
  } catch (err) {
    console.error("[CALLBACK NOTICES] Could not tell the salon about a callback:", err);
  }
}
