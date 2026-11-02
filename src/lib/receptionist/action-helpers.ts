import type { SalonConfig } from "@/lib/booking";
import { servicesLike, serviceIsStaffedOn, type SalonService } from "@/lib/salon-config";
import { normalisePhone } from "@/lib/phone";
import { formatMoneyShort } from "@/lib/money";
import {
  addCalendarDays,
  parseDateOnly,
  zonedDateString,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import { findClientOnNumber } from "@/lib/client-link";
import { spokenPatchTest } from "@/lib/patch-test";

/**
 * Small pieces the receptionist's actions share: reading what the model sent
 * (blank fields, client type, an email, the caller's number), saying a time or
 * a day, and the replies for a service the salon does not recognise.
 */

/** Loose enough to be useful, strict enough to reject a mis-heard word. */
export function validEmail(raw: string | undefined): string | null {
  const e = blankToUndefined(raw);
  if (!e) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e.toLowerCase() : null;
}

/**
 * Settle on a usable number from what the agent sent and the caller ID.
 *
 * The model transcribes a number it heard spoken and gets it wrong — one call
 * sent "4782" while simultaneously holding the full number for the booking.
 * `callerNumber` is the caller ID, which the line fills in on every tool call
 * (receptionist/tools.ts) and which nobody has to hear correctly.
 *
 * Caller ID is the fallback rather than the default because people ring on
 * behalf of others, and the number they give is the one they want used.
 */
export type ResolvedPhone =
  | { ok: true; e164: string; source: "given" | "callerId" }
  | { ok: false; reason: string };

export function resolveCallerPhone(
  spoken: string | undefined,
  callerId: string | undefined
): ResolvedPhone {
  const fromSpoken = normalisePhone(blankToUndefined(spoken));
  if (fromSpoken.ok) return { ok: true, e164: fromSpoken.e164, source: "given" };

  const fromCaller = normalisePhone(blankToUndefined(callerId));
  if (fromCaller.ok) return { ok: true, e164: fromCaller.e164, source: "callerId" };

  return {
    ok: false,
    reason: blankToUndefined(spoken)
      ? fromSpoken.reason
      : "No number was given.",
  };
}

/**
 * The caller's patch test, if the salon has one on record: the day, as it is
 * said, or null. Looked up by the number they gave or rang from, and the name
 * the booking is for, the same way book_appointment picks the client record —
 * a mum's test does not count for her daughter on the same phone.
 *
 * A test on record answers the colour question: no new test, no 48-hour wait.
 */
export async function patchTestOnFile(
  organizationId: string,
  params: { customerPhone?: string; callerNumber?: string; customerName?: string }
): Promise<string | null> {
  const phone = resolveCallerPhone(params.customerPhone, params.callerNumber);
  if (!phone.ok) return null;
  const client = await findClientOnNumber(organizationId, phone.e164, blankToUndefined(params.customerName));
  return client?.patchTestAt ? spokenPatchTest(client.patchTestAt) : null;
}

/**
 * What to tell the agent when the spoken services did not fully resolve.
 *
 * Shared by availability, booking and rescheduling. Three cases, because each
 * needs a different next line from the receptionist:
 *
 * - Could be several services ("a blow dry" is short, medium or long hair):
 *   name them, so the question it asks comes from the price list rather than
 *   its own guess at what differs.
 * - Not on the list at all ("balayage" at a salon that does not list it): say
 *   so plainly. Left to itself the model decided balayage was a kind of
 *   highlights and told the caller the salon does it.
 * - Half understood: name what was recognised, so the model corrects one
 *   service rather than starting the whole request again.
 */
export function serviceNotResolvedMessage(
  spoken: string | undefined,
  matched: SalonService[],
  unmatched: string[],
  services: SalonService[]
): string {
  const vague = unmatched.join(" ").trim() || (spoken ?? "").trim();
  const options = servicesLike(vague, services);
  const have = matched.length
    ? `I have ${matched.map((s) => s.name).join(" and ")}. `
    : "";
  const name = (s: SalonService) =>
    s.priceMinor !== null ? `${s.name} (from ${formatMoneyShort(s.priceMinor)})` : s.name;

  if (options.length > 1) {
    return (
      `${have}"${vague}" could be any of: ${options.map(name).join("; ")}. ` +
      "Ask the caller which one, in plain words (for a blow dry or colour, how " +
      "long their hair is), then use that exact service name. Do not pick one for them."
    );
  }
  if (options.length === 1) {
    return (
      `${have}"${vague}" is probably ${options[0].name}. Check that with the ` +
      "caller, then use that exact service name."
    );
  }
  return (
    `${have}"${vague}" is not on this salon's service list, so the salon does ` +
    "not offer it by that name. Do not say that it does. Tell the caller it " +
    "is not on the price list, mention the closest listed service if one " +
    "plainly fits, and offer to take a message so the stylist can ring them back." +
    (matched.length
      ? " Then send every service they do want in one call, so the diary allows time for all of it."
      : "")
  );
}

/** A model often sends an unset field as "": that means absent. */
export function blankToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}


export function normaliseClientType(
  raw: string | undefined
): "new" | "returning" | "unknown" {
  const v = (blankToUndefined(raw) ?? "").toLowerCase();
  if (v === "new") return "new";
  if (v === "returning" || v === "existing" || v === "regular") return "returning";
  return "unknown";
}

/** "half past two" reads better than "14:30" down a phone line. */
export function spokenTime(iso: string, timeZone: string): string {
  const { hour, minute } = zonedParts(new Date(iso), timeZone);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  if (minute === 0) return `${h12}${suffix}`;
  if (minute === 15) return `quarter past ${h12}`;
  if (minute === 30) return `half past ${h12}`;
  if (minute === 45) return `quarter to ${h12 === 12 ? 1 : h12 + 1}`;
  return `${h12}:${String(minute).padStart(2, "0")}${suffix}`;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Whether anyone who performs `service` is rostered on the weekday that
 * `date` falls on, in the salon's timezone.
 *
 * Anchored at noon before reading the weekday, the same way availability
 * does it: midnight can land on the other side of a DST shift and report
 * the neighbouring day.
 */
export function serviceStaffedOnDate(
  cfg: SalonConfig,
  service: SalonService,
  date: string
): boolean {
  const { year, month, day } = parseDateOnly(date);
  const noon = zonedWallTimeToUtc(year, month, day, 12, 0, cfg.timeZone);
  const { weekday } = zonedParts(noon, cfg.timeZone);
  return serviceIsStaffedOn(service, cfg.stylists, weekday);
}

/**
 * Name a day the way someone says it out loud.
 *
 * A forward search answers about a day the caller did not name, so the day
 * has to come back with the time — "quarter to twelve" on its own is how
 * somebody turns up on the wrong morning.
 */
export function spokenDay(date: string, timeZone: string, now = new Date()): string {
  const today = zonedDateString(now, timeZone);
  if (date === today) return "today";
  if (date === addCalendarDays(today, 1)) return "tomorrow";

  const { year, month, day } = parseDateOnly(date);
  const noon = zonedWallTimeToUtc(year, month, day, 12, 0, timeZone);
  const name = DAY_NAMES[zonedParts(noon, timeZone).weekday];

  // Past a week a weekday name alone is ambiguous — "Thursday" could be
  // either of two, and the caller will assume the nearer one.
  if (date <= addCalendarDays(today, 6)) return name;

  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${name} the ${day}${suffix}`;
}
