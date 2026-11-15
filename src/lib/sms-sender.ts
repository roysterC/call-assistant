/**
 * Who a salon's texts come from, and whether it can send them at all.
 *
 * A text needs a sender: a name of up to 11 characters ("HOANG NAILS"), which
 * is one-way and is what we use, or a number. There was no way to set one in
 * Admin: only a PhoneNumber row put in the database by hand, or the server's
 * shared default. A salon set up without either had every confirmation fail
 * with "No SMS sender configured", and the CRM only said the text did not
 * send. Now Kikai types the name in Admin (OrganizationSettings.smsSender),
 * and Admin and Settings both say when a salon cannot send texts.
 *
 * Plain code, no database: the Admin page works the status out from what is
 * on screen as the name is typed.
 */

import { normalisePhone } from "@/lib/phone";

/** The longest a sender name can be: the networks' limit. */
export const SENDER_NAME_MAX = 11;

/** A sender as typed in Admin: blank (none), a name, or a phone number. */
export function parseSmsSender(raw: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, reason: "The text sender must be text." };
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  // A number: kept in international form.
  if (/^\+?[\d\s()-]+$/.test(v)) {
    const phone = normalisePhone(v);
    return phone.ok ? { ok: true, value: phone.e164 } : { ok: false, reason: phone.reason };
  }
  if (v.length > SENDER_NAME_MAX || !/^[A-Za-z0-9 ]+$/.test(v)) {
    return { ok: false, reason: `A sender name is up to ${SENDER_NAME_MAX} letters, numbers and spaces.` };
  }
  if (!/[A-Za-z]/.test(v)) return { ok: false, reason: "A sender name needs at least one letter." };
  return { ok: true, value: v };
}

export interface TextsStatus {
  ready: boolean;
  /** Who texts come from, when there is a sender. */
  sender: string | null;
  /** Why not: texts are not set up on the server, or this salon has no sender. */
  problem: "not_configured" | "no_sender" | null;
}

/**
 * Whether a salon's texts can go, and from whom: a texting number of its own
 * first (a PhoneNumber row), then the name set in Admin, then the server's
 * shared default.
 */
export function textsStatus(s: {
  configured: boolean;
  smsNumber?: string | null;
  salonSender?: string | null;
  defaultSender?: string | null;
}): TextsStatus {
  const sender = s.smsNumber || s.salonSender || s.defaultSender || null;
  if (!s.configured) return { ready: false, sender, problem: "not_configured" };
  if (!sender) return { ready: false, sender: null, problem: "no_sender" };
  return { ready: true, sender, problem: null };
}
