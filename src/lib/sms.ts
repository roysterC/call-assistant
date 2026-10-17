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
import { smsSize, toGsm } from "@/lib/sms-encoding";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export type SmsResult =
  | { ok: true; sid: string; sender: string; segments: number }
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

  // Plain characters only, where there is a plain equivalent: one curly
  // apostrophe or long dash would bill the whole text at 70 characters a
  // segment instead of 160. See sms-encoding.ts.
  const text = toGsm(body);
  const size = smsSize(text);

  try {
    const params = new URLSearchParams({
      To: recipient.e164,
      From: sender,
      Body: text,
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

    console.log(
      `[SMS] sent ${data.sid}: ${size.segments} segment${size.segments === 1 ? "" : "s"} (${size.encoding}, ${size.length} chars)`
    );
    return { ok: true, sid: data.sid, sender, segments: size.segments };
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
  /**
   * The salon's number for the booking. Quoting it on the phone is enough to
   * move or cancel it, whoever is ringing, so it goes on every text that
   * describes a booking that still stands.
   */
  bookingNumber?: number | null;
  /**
   * Set when the text goes to the person a client is reached through (a
   * parent), and `clientName` is then theirs: "Hi Claire — Amy is booked in".
   */
  forName?: string | null;
}

/** "you're" or "Amy is", "your" or "Amy's", as the text is for them or about them. */
function subject(i: AppointmentMessageInput): { is: string; whose: string } {
  return i.forName ? { is: `${i.forName} is`, whose: `${i.forName}'s` } : { is: "you're", whose: "your" };
}

/**
 * The first wording that goes as one segment, or else the last (the
 * tightest). Each text tries the friendlier wording first and only falls back
 * to the clipped one when a long service name or date would tip it into a
 * second segment, which doubles what it costs.
 */
function oneSegment(...wordings: string[]): string {
  return wordings.find((w) => smsSize(toGsm(w)).segments === 1) ?? wordings[wordings.length - 1];
}

function greeting(i: AppointmentMessageInput): string {
  return i.clientName ? `Hi ${i.clientName}, ` : "";
}

/** "Booking no. 1042. " or, when room is short, "Ref 1042. ". */
function bookingRef(n: number | null | undefined, short = false): string {
  if (!n) return "";
  return short ? `Ref ${n}. ` : `Booking no. ${n}. `;
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

/** How to change it, then who it is from. The sender is one-way, so the number matters. */
function signOff(i: AppointmentMessageInput, short = false): string {
  if (!i.contactPhone) return i.businessName;
  return short
    ? `To change, call ${i.contactPhone}. ${i.businessName}`
    : `Call us on ${i.contactPhone} if that doesn't suit. ${i.businessName}`;
}

export function confirmationBody(i: AppointmentMessageInput): string {
  const say = (short: boolean) =>
    `${greeting(i)}${subject(i).is} booked in ${i.whenText} for ${withArticle(i.serviceName)} ` +
    `with ${i.stylistName}. ${bookingRef(i.bookingNumber, short)}${signOff(i, short)}`;
  return oneSegment(say(false), say(true));
}

export function reminderBody(i: AppointmentMessageInput): string {
  const say = (short: boolean) =>
    `${greeting(i)}${short ? "reminder:" : "a reminder"} ${subject(i).is} booked in ${i.whenText} for ` +
    `${withArticle(i.serviceName)} with ${i.stylistName}. ` +
    `${bookingRef(i.bookingNumber, short)}${signOff(i, short)}`;
  return oneSegment(say(false), say(true));
}

export function cancellationBody(i: AppointmentMessageInput): string {
  const rebook = (short: boolean) =>
    !i.contactPhone
      ? i.businessName
      : short
        ? `To rebook, call ${i.contactPhone}. ${i.businessName}`
        : `Call us on ${i.contactPhone} to rebook. ${i.businessName}`;
  const say = (short: boolean) =>
    `${greeting(i)}${subject(i).whose} appointment ${i.whenText} for ${withArticle(i.serviceName)} ` +
    `has been cancelled. ${rebook(short)}`;
  return oneSegment(say(false), say(true));
}

export function rescheduleBody(
  i: AppointmentMessageInput & { previousWhenText: string }
): string {
  const say = (short: boolean) =>
    `${greeting(i)}${subject(i).whose} ${i.serviceName.toLowerCase()} has moved from ` +
    `${i.previousWhenText} to ${i.whenText} with ${i.stylistName}. ` +
    `${bookingRef(i.bookingNumber, short)}${signOff(i, short)}`;
  return oneSegment(say(false), say(true));
}
