/**
 * Why a text did not go, in words a salon can act on. The reason stored on an
 * appointment (confirmationError) is ours or Twilio's, written for us: "No
 * SMS sender configured for this organization", "Attempt to send to
 * unsubscribed recipient". The CRM showed only that the text did not send.
 *
 * Returns the message to show, or null where the reason is not one we know,
 * when it is shown as stored.
 */

import type { MessageKey } from "@/lib/i18n";

const REASONS: Array<{ test: RegExp; key: MessageKey }> = [
  { test: /no sms sender configured/i, key: "textFail.noSender" },
  { test: /twilio credentials are not set/i, key: "textFail.notConfigured" },
  { test: /not a mobile/i, key: "textFail.notMobile" },
  { test: /no number|no number given|no number to text/i, key: "textFail.noNumber" },
  { test: /unverified|trial account/i, key: "textFail.trial" },
  { test: /unsubscribed|opted out|21610/i, key: "textFail.optedOut" },
  { test: /permission to send an sms has not been enabled for the region|21408/i, key: "textFail.region" },
  { test: /'from'|from phone number|alphanumeric sender|21212|21606/i, key: "textFail.badSender" },
  { test: /not a valid phone number|21211|21614/i, key: "textFail.invalid" },
  // "Authenticate" (20003), or "authentication failed, auth token is not valid": the server's Twilio keys.
  { test: /authenticat|auth token|20003|insufficient|balance|suspended/i, key: "textFail.account" },
  { test: /fetch failed|econn|etimedout|timed out|network|socket/i, key: "textFail.network" },
];

export function textFailureKey(reason: string | null | undefined): MessageKey | null {
  if (!reason) return null;
  return REASONS.find((r) => r.test.test(reason))?.key ?? null;
}

/**
 * A reason we do not know, as it may be shown: without Twilio account and
 * message ids, which mean nothing to a salon and are ours to keep.
 */
export function shownFailureReason(reason: string): string {
  return reason.replace(/\b(AC|SM|MM)[0-9a-f]{32}\b/gi, "").replace(/\s+([,.])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
