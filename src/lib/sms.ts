/**
 * Outbound SMS, via Twilio's REST API.
 *
 * Called directly rather than through the Twilio SDK: this needs one endpoint
 * with basic auth, and the SDK is a large dependency for a single POST.
 *
 * Credentials are agency-level in the environment, following the WhatsApp
 * precedent rather than the Meta one — the thing that genuinely has to differ
 * per tenant is the sender the customer sees, and that comes from a
 * `PhoneNumber` row.
 *
 * Nothing here throws. A text that fails to send must never take a booking
 * with it: the appointment is real, in the diary, and the client can be rung.
 * Failures are returned so the caller can record them and staff can see that
 * a message did not go.
 */

import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export type SmsResult =
  | { ok: true; sid: string; sender: string }
  | { ok: false; reason: string; configured: boolean };

export function smsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  );
}

/**
 * The sender a given organization's texts come from.
 *
 * A `PhoneNumber` row with channel "sms" wins; otherwise the shared default.
 * An alphanumeric sender ID ("SHOGO") is allowed and is what we recommend —
 * it is cheap and needs no number, at the cost of being one-way. That is why
 * every message body carries the salon's landline.
 */
async function resolveSender(organizationId: string): Promise<string | null> {
  const row = await prisma.phoneNumber.findFirst({
    where: { organizationId, channel: "sms", active: true },
    select: { number: true, smsSenderId: true },
  });
  if (row) return row.smsSenderId || row.number;
  return process.env.TWILIO_DEFAULT_SENDER || null;
}

export async function sendSms(
  organizationId: string,
  to: string,
  body: string
): Promise<SmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return {
      ok: false,
      configured: false,
      reason: "Twilio credentials are not set",
    };
  }

  const recipient = normalisePhone(to);
  if (!recipient.ok) {
    return { ok: false, configured: true, reason: recipient.reason };
  }
  if (!recipient.isMobile) {
    // Texting a landline silently succeeds at the API and never arrives.
    return {
      ok: false,
      configured: true,
      reason: "That number is not a mobile, so it cannot receive a text.",
    };
  }

  const sender = await resolveSender(organizationId);
  if (!sender) {
    return {
      ok: false,
      configured: false,
      reason: "No SMS sender configured for this organization",
    };
  }

  try {
    const params = new URLSearchParams({
      To: recipient.e164,
      From: sender,
      Body: body,
    });

    const res = await fetch(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = (await res.json()) as { sid?: string; message?: string };

    if (!res.ok || !data.sid) {
      const reason = data.message || `Twilio returned ${res.status}`;
      console.error("[SMS] send failed:", reason);
      return { ok: false, configured: true, reason };
    }

    return { ok: true, sid: data.sid, sender };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "SMS request failed";
    console.error("[SMS] send threw:", reason);
    return { ok: false, configured: true, reason };
  }
}

// -------------------------------------------------------------------------
// Message bodies
//
// Kept together so the two messages read like the same salon wrote them, and
// so the landline is impossible to leave out — the sender is one-way, and a
// confirmation nobody can reply to is a dead end without it.
// -------------------------------------------------------------------------

export interface AppointmentMessageInput {
  clientName: string | null;
  serviceName: string;
  stylistName: string;
  /** Already formatted for the salon's timezone, e.g. "Thursday at 2pm". */
  whenText: string;
  businessName: string;
  contactPhone: string | null;
}

/**
 * "a cut and finish", "an Olaplex treatment", "full head highlights".
 *
 * Service names are whatever the salon typed, so the article has to be worked
 * out rather than hardcoded: plurals take none, and a vowel sound takes "an".
 * "a full head highlights" is the sort of thing that makes a confirmation read
 * like it came from a machine.
 */
function withArticle(serviceName: string): string {
  const name = serviceName.toLowerCase();
  // Plural — no article. Catches "highlights", "extensions", "curls".
  if (/s$/.test(name) && !/ss$/.test(name)) return name;
  return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
}

function signOff(contactPhone: string | null, businessName: string): string {
  return contactPhone
    ? `Call us on ${contactPhone} if that doesn't suit. ${businessName}`
    : `${businessName}`;
}

export function confirmationBody(i: AppointmentMessageInput): string {
  const greeting = i.clientName ? `Hi ${i.clientName} — ` : "";
  return (
    `${greeting}you're booked in ${i.whenText} for ${withArticle(i.serviceName)} ` +
    `with ${i.stylistName}. ${signOff(i.contactPhone, i.businessName)}`
  );
}

export function reminderBody(i: AppointmentMessageInput): string {
  const greeting = i.clientName ? `Hi ${i.clientName} — ` : "";
  return (
    `${greeting}a reminder you're booked in ${i.whenText} for ` +
    `${withArticle(i.serviceName)} with ${i.stylistName}. ` +
    `${signOff(i.contactPhone, i.businessName)}`
  );
}

export function cancellationBody(i: AppointmentMessageInput): string {
  const greeting = i.clientName ? `Hi ${i.clientName} — ` : "";
  return (
    `${greeting}your appointment ${i.whenText} for ${withArticle(i.serviceName)} ` +
    `has been cancelled. ${signOff(i.contactPhone, i.businessName)}`
  );
}

export function rescheduleBody(
  i: AppointmentMessageInput & { previousWhenText: string }
): string {
  const greeting = i.clientName ? `Hi ${i.clientName} — ` : "";
  return (
    `${greeting}your ${i.serviceName.toLowerCase()} has moved from ` +
    `${i.previousWhenText} to ${i.whenText} with ${i.stylistName}. ` +
    `${signOff(i.contactPhone, i.businessName)}`
  );
}
