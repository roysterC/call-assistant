/**
 * Phone number normalisation.
 *
 * Numbers reach us spoken and transcribed — "oh seven seven six oh, one two
 * four five two three" — so they arrive with spaces, sometimes an extra digit,
 * sometimes a country code and sometimes not. Storing whatever arrived means
 * the same caller becomes two leads, and an SMS confirmation goes to a number
 * that cannot receive it.
 *
 * A wrong number is worse than no number here: the salon rings back, gets a
 * stranger, and the appointment sits in the diary unconfirmed. So a number
 * that does not normalise cleanly is refused rather than stored hopefully.
 */

/** Default region for bare national numbers. The salon is in the UK. */
export const DEFAULT_REGION = "GB";

const UK_COUNTRY_CODE = "44";

// After +44, a UK number is 9 or 10 digits and starts with one of these:
//   1, 2, 3 - landline and non-geographic
//   7       - mobile
//   8       - freephone / special
const UK_VALID_FIRST_DIGITS = new Set(["1", "2", "3", "7", "8"]);

export type PhoneResult =
  | { ok: true; e164: string; national: string; isMobile: boolean }
  | { ok: false; reason: string };

function digitsOnly(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Normalise a spoken or typed number to E.164.
 *
 * Accepts the shapes callers and transcribers actually produce:
 *   07760 124523   +44 7760 124523   447760124523
 *   00447760124523   7760124523
 */
export function normalisePhone(
  input: string | undefined | null,
  region: string = DEFAULT_REGION
): PhoneResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "No number given." };

  const hadPlus = raw.startsWith("+");
  let digits = digitsOnly(raw);

  if (!digits) return { ok: false, reason: "That did not contain any digits." };

  // A number already in international form, for somewhere other than the UK.
  // Length-check only: validating every national numbering plan is not this
  // module's job, and refusing a legitimate foreign number would be worse.
  if (hadPlus && !digits.startsWith(UK_COUNTRY_CODE)) {
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, reason: "That is not a usable international number." };
    }
    return {
      ok: true,
      e164: `+${digits}`,
      national: digits,
      isMobile: false,
    };
  }

  if (region !== "GB") {
    // Only the UK plan is implemented; anything else must arrive in E.164.
    if (!hadPlus) {
      return {
        ok: false,
        reason: "Non-UK numbers must include the country code.",
      };
    }
    return { ok: true, e164: `+${digits}`, national: digits, isMobile: false };
  }

  // 00 44 ... - the older international prefix.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // 44 ... - country code without a plus.
  if (digits.startsWith(UK_COUNTRY_CODE) && digits.length > 11) {
    digits = digits.slice(UK_COUNTRY_CODE.length);
  }

  // 0 ... - national trunk prefix.
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");

  if (!digits) return { ok: false, reason: "That was only zeroes." };

  const first = digits[0];
  if (!UK_VALID_FIRST_DIGITS.has(first)) {
    return {
      ok: false,
      reason: `A UK number does not start with ${first} after the zero.`,
    };
  }

  if (digits.length < 9) {
    return {
      ok: false,
      reason: `That is ${digits.length + 1} digits — too short for a UK number.`,
    };
  }
  if (digits.length > 10) {
    return {
      ok: false,
      reason: `That is ${digits.length + 1} digits — too long for a UK number.`,
    };
  }

  // UK mobiles are 07xxx xxxxxx, so ten digits beginning 7 once the 0 is off.
  const isMobile = first === "7" && digits.length === 10;

  return {
    ok: true,
    e164: `+${UK_COUNTRY_CODE}${digits}`,
    national: `0${digits}`,
    isMobile,
  };
}

/**
 * Read a number back the way a person would say it, for confirmation.
 *
 * "oh seven seven six oh, one two four five two three" — grouped, because a
 * flat run of eleven digits is impossible to follow on a phone call.
 */
export function speakablePhone(e164: string): string {
  const r = normalisePhone(e164);
  if (!r.ok) return e164;
  const n = r.national;
  if (r.isMobile) return `${n.slice(0, 5)} ${n.slice(5)}`;
  return `${n.slice(0, 5)} ${n.slice(5)}`;
}
