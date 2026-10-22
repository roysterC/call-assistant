/**
 * The in-person lead funnel (/meet): what it asks, and checking the answers.
 * Shared by the page, which checks each answer as it is given, and the API,
 * which checks them all again before anything is saved.
 */

import { normalisePhone } from "@/lib/phone";

/** Booking systems a salon is likely to name; one tap instead of typing. */
export const KNOWN_SYSTEMS = ["Fresha", "Phorest", "Timely", "Booksy", "Treatwell", "Salon Iris"] as const;

export interface FunnelAnswers {
  /** Do they already use a system? */
  hasSystem: boolean;
  /** Which one, if they said so. Optional: "skip" is fine. */
  system?: string | null;
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
}

export type FunnelField = "hasSystem" | "system" | "businessName" | "ownerName" | "phone" | "email";

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function checkBusinessName(v: unknown): Checked<string> {
  const value = clean(v, 120);
  return value.length >= 2 ? { ok: true, value } : { ok: false, message: "What's the business called?" };
}

export function checkOwnerName(v: unknown): Checked<string> {
  const value = clean(v, 120);
  return value.length >= 2 ? { ok: true, value } : { ok: false, message: "Who owns the business?" };
}

/** A UK mobile or landline, stored in +44 form like every other channel's numbers. */
export function checkPhone(v: unknown): Checked<string> {
  const raw = clean(v, 40);
  if (!raw) return { ok: false, message: "A number to reach them on." };
  const phone = normalisePhone(raw);
  if (!phone.ok) return { ok: false, message: "That number doesn't look right." };
  // A few landlines have ten digits, so the general check allows them; a
  // mobile (07…) always has eleven, and one short is a typo.
  if (phone.national.startsWith("07") && !phone.isMobile) {
    return { ok: false, message: "A mobile number has 11 digits." };
  }
  return { ok: true, value: phone.e164 };
}

export function checkEmail(v: unknown): Checked<string> {
  const value = clean(v, 200).toLowerCase();
  if (!value) return { ok: false, message: "An email address to send things to." };
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
    ? { ok: true, value }
    : { ok: false, message: "That email doesn't look right." };
}

/** Every answer, checked; the first problem names its field so the page can go back to it. */
export function checkAnswers(
  input: Record<string, unknown>
): { ok: true; value: FunnelAnswers } | { ok: false; field: FunnelField; message: string } {
  if (typeof input.hasSystem !== "boolean") {
    return { ok: false, field: "hasSystem", message: "Do they already use a system?" };
  }
  const businessName = checkBusinessName(input.businessName);
  if (!businessName.ok) return { ok: false, field: "businessName", message: businessName.message };
  const ownerName = checkOwnerName(input.ownerName);
  if (!ownerName.ok) return { ok: false, field: "ownerName", message: ownerName.message };
  const phone = checkPhone(input.phone);
  if (!phone.ok) return { ok: false, field: "phone", message: phone.message };
  const email = checkEmail(input.email);
  if (!email.ok) return { ok: false, field: "email", message: email.message };
  const system = input.hasSystem ? clean(input.system, 60) || null : null;
  return {
    ok: true,
    value: {
      hasSystem: input.hasSystem,
      system,
      businessName: businessName.value,
      ownerName: ownerName.value,
      phone: phone.value,
      email: email.value,
    },
  };
}

/**
 * Where they book a free consultation, offered once their details are in:
 * a Calendly page, or a Google Calendar booking page. Only these two hosts,
 * over https: the page frames the link, and the security policy allows
 * exactly these.
 *
 * - Calendly: shown with their name and email filled in, and it tells the
 *   page when a time is booked.
 * - Google Calendar: the booking page's own link
 *   (calendar.google.com/calendar/appointments/schedules/...), set to
 *   Google's embeddable form. Google fills nothing in and says nothing back.
 *   A short calendar.app.google link cannot be framed; the server turns it
 *   into the full one first (consultation-link.ts).
 */
export type ConsultationBooking = { kind: "calendly" | "google"; url: string };

export function consultationBooking(raw: string | null | undefined): ConsultationBooking | null {
  let url: URL;
  try {
    url = new URL((raw ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "calendly.com") return { kind: "calendly", url: url.toString() };
  if (url.hostname === "calendar.google.com") {
    // ".../calendar/u/0/appointments/schedules/<id>" and the like.
    const id = url.pathname.match(/\/appointments\/schedules\/([A-Za-z0-9_-]+)/)?.[1];
    if (!id) return null;
    return {
      kind: "google",
      url: `https://calendar.google.com/calendar/appointments/schedules/${id}?gv=true`,
    };
  }
  return null;
}

/** Google's short share link, which has to be turned into the full one before it can be shown. */
export function isGoogleShortLink(raw: string | null | undefined): boolean {
  try {
    const url = new URL((raw ?? "").trim());
    return url.protocol === "https:" && url.hostname === "calendar.app.google";
  } catch {
    return false;
  }
}

/** The line the Leads page shows for them: where they stand today. */
export function systemSummary(a: Pick<FunnelAnswers, "hasSystem" | "system">): string {
  if (!a.hasSystem) return "No booking system yet";
  return a.system ? `Already uses ${a.system}` : "Already uses a booking system";
}
