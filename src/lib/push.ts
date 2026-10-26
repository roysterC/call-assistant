/**
 * Push notifications to the phones and computers staff turned them on for
 * (Account → "Booking alerts on this device"), through each browser's own
 * push service. Nothing to sign up for: the server signs its messages with
 * a key pair of its own (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY), which the
 * deploy makes once and keeps in .env (scripts/ensure-push-keys.ts).
 *
 * Runs in the CRM and in the voice server, which takes the phone's bookings;
 * both read the same .env.
 */

import webpush from "web-push";
import { prisma } from "@/lib/prisma";

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** A second message with the same tag replaces the first on the device. */
  tag?: string;
}

/** The key browsers subscribe with, or null when push is not set up. */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

/**
 * Who the push services can contact about these messages: a mailto: or an
 * https address. The CRM's own address does, and Apple refuses anything else.
 */
function subject(): string | null {
  const set = process.env.VAPID_SUBJECT?.trim();
  if (set) return set;
  try {
    const url = new URL(process.env.AUTH_URL ?? "");
    if (url.protocol === "https:") return url.origin;
  } catch {
    // Not set, or not a URL.
  }
  return null;
}

let ready: boolean | null = null;

function setUp(): boolean {
  if (ready !== null) return ready;
  const pub = pushPublicKey();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const who = subject();
  if (!pub || !priv || !who) {
    console.warn("[PUSH] Not set up: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and an https AUTH_URL (or VAPID_SUBJECT) are needed.");
    return (ready = false);
  }
  webpush.setVapidDetails(who, pub, priv);
  return (ready = true);
}

/**
 * Send one message to every device these people turned alerts on for. Never
 * throws: an alert that does not arrive must not undo what it is about.
 * A device its push service says has gone (unsubscribed, app removed) is
 * forgotten.
 */
export async function pushToUsers(userIds: string[], message: PushMessage): Promise<{ sent: number; failed: number }> {
  if (userIds.length === 0 || !setUp()) return { sent: 0, failed: 0 };
  try {
    const devices = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
    const payload = JSON.stringify(message);
    const results = await Promise.allSettled(
      devices.map((d) =>
        webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, {
          // A booking alert still matters later in the day; not tomorrow.
          TTL: 12 * 3600,
          urgency: "high",
        })
      )
    );
    let sent = 0;
    let failed = 0;
    const gone: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") return void sent++;
      failed++;
      const status = (r.reason as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) gone.push(devices[i].id);
      else console.warn(`[PUSH] Not delivered (${status ?? "no status"}):`, (r.reason as Error)?.message);
    });
    if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    return { sent, failed };
  } catch (err) {
    console.error("[PUSH] Sending failed:", err);
    return { sent: 0, failed: 0 };
  }
}
