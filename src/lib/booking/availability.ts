/**
 * Slot arithmetic.
 *
 * Deliberately pure: it takes busy blocks as input rather than fetching them,
 * so the rules that matter — service duration, patch-test lead time, closing
 * time, DST — are testable without a Google account. The provider does the
 * I/O; this decides what is bookable.
 *
 * Every rule here is enforced in code rather than described in the system
 * prompt. A language model that forgets a 48-hour patch-test window books a
 * client in for a colour they cannot legally have.
 */

import {
  type BusinessHours,
  openWindowFor,
  parseDateOnly,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import {
  type SalonService,
  type Stylist,
  stylistWorksOn,
} from "@/lib/salon-config";
import type { TimeSlot } from "./types";

export interface BusyBlock {
  start: Date;
  end: Date;
  calendarId?: string;
}

export interface StylistAvailability {
  stylist: Stylist;
  busy: BusyBlock[];
}

export interface SlotComputationInput {
  /** YYYY-MM-DD in `timeZone`. */
  date: string;
  timeZone: string;
  hours: BusinessHours;
  service: SalonService;
  candidates: StylistAvailability[];
  clientType?: "new" | "returning" | "unknown";
  /** Injected so tests are deterministic. */
  now?: Date;
  /** No bookings inside this window from now. */
  minLeadMinutes?: number;
  /** Slot start times are aligned to this. */
  granularityMinutes?: number;
  /** Skin test lead time for colour services, for new clients. */
  patchTestLeadHours?: number;
}

export const DEFAULT_MIN_LEAD_MINUTES = 120;
export const DEFAULT_GRANULARITY_MINUTES = 15;
export const DEFAULT_PATCH_TEST_LEAD_HOURS = 48;

const MINUTE = 60 * 1000;

function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The earliest instant a booking may start, given lead-time rules.
 *
 * Exported because the tool handler needs to explain the constraint to the
 * caller ("a colour needs a skin test 48 hours before"), and the explanation
 * and the filter must come from the same number.
 */
export function earliestBookableStart(
  service: SalonService,
  clientType: "new" | "returning" | "unknown",
  now: Date,
  minLeadMinutes = DEFAULT_MIN_LEAD_MINUTES,
  patchTestLeadHours = DEFAULT_PATCH_TEST_LEAD_HOURS
): { at: Date; reason: "lead_time" | "patch_test" } {
  const leadFloor = new Date(now.getTime() + minLeadMinutes * MINUTE);

  // A client we have not seen before cannot have colour without a skin test.
  // "unknown" is treated as new: the cost of an unnecessary delay is a
  // rescheduled appointment; the cost of the reverse is a chemical burn.
  const needsPatchTest = service.requiresPatchTest && clientType !== "returning";
  if (!needsPatchTest) return { at: leadFloor, reason: "lead_time" };

  const patchFloor = new Date(now.getTime() + patchTestLeadHours * 60 * MINUTE);
  return patchFloor > leadFloor
    ? { at: patchFloor, reason: "patch_test" }
    : { at: leadFloor, reason: "lead_time" };
}

/**
 * Bookable slots for one date, across every candidate stylist.
 *
 * Returns slots sorted by start time then stylist name. Callers trim — a voice
 * agent must never read thirty options aloud.
 */
export function computeBookableSlots(input: SlotComputationInput): TimeSlot[] {
  const {
    date,
    timeZone,
    hours,
    service,
    candidates,
    clientType = "unknown",
    now = new Date(),
    minLeadMinutes = DEFAULT_MIN_LEAD_MINUTES,
    granularityMinutes = DEFAULT_GRANULARITY_MINUTES,
    patchTestLeadHours = DEFAULT_PATCH_TEST_LEAD_HOURS,
  } = input;

  const openWindow = openWindowFor(hours, timeZone, date);
  if (!openWindow) return []; // closed, or hours unconfigured

  const { year, month, day } = parseDateOnly(date);
  const noon = zonedWallTimeToUtc(year, month, day, 12, 0, timeZone);
  const { weekday } = zonedParts(noon, timeZone);

  const floor = earliestBookableStart(
    service,
    clientType,
    now,
    minLeadMinutes,
    patchTestLeadHours
  ).at;

  const durationMs = service.durationMinutes * MINUTE;
  const bufferMs = service.bufferMinutes * MINUTE;
  const stepMs = granularityMinutes * MINUTE;

  const slots: TimeSlot[] = [];

  for (const { stylist, busy } of candidates) {
    if (!stylist.googleCalendarId) continue;
    if (!stylistWorksOn(stylist, weekday)) continue;

    for (
      let start = new Date(openWindow.start.getTime());
      // The service itself must finish before close. The tidy-up buffer may
      // run past closing time — that is how a salon actually works — but it
      // still has to be free of other bookings, checked below.
      start.getTime() + durationMs <= openWindow.end.getTime();
      start = new Date(start.getTime() + stepMs)
    ) {
      if (start < floor) continue;

      const serviceEnd = new Date(start.getTime() + durationMs);
      const blockEnd = new Date(serviceEnd.getTime() + bufferMs);

      const clash = busy.some((b) =>
        overlaps(start, blockEnd, b.start, b.end)
      );
      if (clash) continue;

      slots.push({
        start: start.toISOString(),
        end: serviceEnd.toISOString(),
        stylistName: stylist.name,
        calendarId: stylist.googleCalendarId,
      });
    }
  }

  slots.sort((a, b) => {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return (a.stylistName ?? "").localeCompare(b.stylistName ?? "");
  });

  return slots;
}

/**
 * Reduce a slot list to something speakable.
 *
 * One option per start time (the caller asked for a time, not a stylist
 * roster) and spread across the day rather than clustered at opening, so
 * "we have ten past nine, twenty past nine, half past nine" never happens.
 */
export function summariseSlotsForSpeech(
  slots: TimeSlot[],
  max = 3
): TimeSlot[] {
  if (slots.length === 0) return [];

  const byStart = new Map<string, TimeSlot>();
  for (const s of slots) {
    if (!byStart.has(s.start)) byStart.set(s.start, s);
  }
  const unique = [...byStart.values()];
  if (unique.length <= max) return unique;

  const picked: TimeSlot[] = [];
  const step = (unique.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    picked.push(unique[Math.round(i * step)]);
  }
  return picked;
}


// -------------------------------------------------------------------------
// Caller preferences
// -------------------------------------------------------------------------

export type TimeOfDay = "morning" | "afternoon" | "evening";

/** Local-time boundaries, in minutes from midnight. */
const TIME_OF_DAY_WINDOWS: Record<TimeOfDay, [number, number]> = {
  morning: [0, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 24 * 60],
};

export interface TimePreference {
  timeOfDay?: TimeOfDay;
  /** "HH:MM" local — no start before this. */
  after?: string;
  /** "HH:MM" local — no start after this. */
  before?: string;
}

function hhmmToMinutes(value: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseTimeOfDay(raw: string | undefined): TimeOfDay | undefined {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "morning" || v === "am") return "morning";
  if (v === "afternoon" || v === "pm") return "afternoon";
  if (v === "evening" || v === "night") return "evening";
  return undefined;
}

/**
 * Narrow slots to what the caller actually asked for.
 *
 * Someone who says "anytime after five" and is then offered nine in the
 * morning has not been listened to. Filtering here rather than hoping the
 * model discards the rest keeps the decision with the code that knows the
 * salon's timezone.
 */
export function filterSlotsByPreference(
  slots: TimeSlot[],
  timeZone: string,
  pref: TimePreference
): TimeSlot[] {
  let lower = 0;
  let upper = 24 * 60;

  if (pref.timeOfDay) {
    [lower, upper] = TIME_OF_DAY_WINDOWS[pref.timeOfDay];
  }
  if (pref.after) {
    const m = hhmmToMinutes(pref.after);
    if (m !== null) lower = Math.max(lower, m);
  }
  if (pref.before) {
    const m = hhmmToMinutes(pref.before);
    if (m !== null) upper = Math.min(upper, m);
  }

  if (lower === 0 && upper === 24 * 60) return slots;

  return slots.filter((s) => {
    const { hour, minute } = zonedParts(new Date(s.start), timeZone);
    const mins = hour * 60 + minute;
    return mins >= lower && mins < upper;
  });
}
