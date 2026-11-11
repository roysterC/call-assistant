/**
 * Telling Kikai when something happens that it would otherwise only learn by
 * looking: an owner joined their salon, an owner finished setting it up.
 * Sent to NOTIFY_EMAIL, set in .env on the server; nowhere if it is unset.
 * Best effort: a notice that cannot go never stops what it is about.
 */

import { actionEmail, sendEmail } from "@/lib/email";

export async function notifyKikai(input: { subject: string; lines: string[]; button: string; url: string }): Promise<void> {
  const to = process.env.NOTIFY_EMAIL?.trim();
  if (!to) return;
  try {
    await sendEmail(
      actionEmail({
        to,
        subject: input.subject,
        heading: input.subject,
        lines: input.lines,
        button: input.button,
        url: input.url,
        footer: "Sent to NOTIFY_EMAIL by the Kikai CRM.",
      })
    );
  } catch (error) {
    console.error("[NOTIFY] failed:", error);
  }
}
