/**
 * Which times the receptionist offers: the salon's rule, kept apart from the
 * diary reads so every case can be tested on its own.
 *
 * - The time the caller asked for, when it is free: just that one. Asking
 *   "would 2 or 4 suit?" of someone who asked for 2, and could have it, is
 *   not listening.
 * - Otherwise two specific choices, never an open "what time suits?":
 *   - on the day they named, one in the morning and one in the afternoon
 *     where the day allows, or two well apart inside the window they gave;
 *   - when they asked for a time that is taken, the two nearest to it;
 *   - when the day they named has nothing (or they named none), the two
 *     soonest, which may be on different days.
 *
 * Each choice carries its own date, so the two are never one day's times
 * read out under another day's name. Who would do it is left to the
 * read-back: one time is one slot, whoever's it is.
 */

import { zonedDateString, zonedParts } from "@/lib/business-hours";
import type { TimeSlot } from "./types";

export interface OfferInput {
  /** Free slots in order, already narrowed to any window the caller gave. */
  slots: TimeSlot[];
  timeZone: string;
  /** The day the caller named, YYYY-MM-DD; for "the soonest", today. */
  day: string;
  /** Whether they named a day, or asked for the soonest. */
  named: boolean;
  /** The time they asked for, "HH:MM", if they asked for one. */
  time?: string | null;
  /** The service's length: two choices closer than this are one choice. */
  minGapMinutes: number;
}

export interface Offer {
  /** "exact": the time they asked for is free. "choices": one or two to choose from. */
  kind: "exact" | "choices" | "none";
  picks: TimeSlot[];
}

/** Two choices on the same day should feel different: ideally two hours apart. */
const WELL_APART_MINUTES = 120;
const NOON = 12 * 60;

export function chooseOffer(input: OfferInput): Offer {
  const { timeZone } = input;
  const dayOf = (s: TimeSlot) => zonedDateString(new Date(s.start), timeZone);
  const minuteOf = (s: TimeSlot) => {
    const p = zonedParts(new Date(s.start), timeZone);
    return p.hour * 60 + p.minute;
  };

  // One time is one choice, whoever's diary it is in.
  const seen = new Set<string>();
  const slots = input.slots.filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)));
  if (slots.length === 0) return { kind: "none", picks: [] };

  const onDay = slots.filter((s) => dayOf(s) === input.day);
  const later = slots.filter((s) => dayOf(s) > input.day);

  const asked = parseHhMm(input.time);
  if (input.named && asked !== null) {
    const exact = onDay.find((s) => minuteOf(s) === asked);
    if (exact) return { kind: "exact", picks: [exact] };
    // Taken: the two nearest to it on that day, then the nearest to that
    // time of day on the days after.
    const near = [...onDay].sort((a, b) => Math.abs(minuteOf(a) - asked) - Math.abs(minuteOf(b) - asked));
    const picks = near.slice(0, 2).sort(byStart);
    if (picks.length < 2) {
      const nextDay = later.length ? dayOf(later[0]) : null;
      const sameTimeLater = later
        .filter((s) => dayOf(s) === nextDay)
        .sort((a, b) => Math.abs(minuteOf(a) - asked) - Math.abs(minuteOf(b) - asked));
      picks.push(...sameTimeLater.slice(0, 2 - picks.length));
    }
    return { kind: "choices", picks };
  }

  if (input.named && onDay.length > 0) {
    // A morning and an afternoon, well apart: 11 and 12 are a morning and
    // an afternoon by the clock, and the same choice to a caller.
    const morning = onDay.find((s) => minuteOf(s) < NOON);
    const afternoons = onDay.filter((s) => minuteOf(s) >= NOON);
    const afternoon = morning
      ? (apartFrom(morning, afternoons, [WELL_APART_MINUTES]) ?? afternoons[afternoons.length - 1])
      : undefined;
    if (morning && afternoon) return { kind: "choices", picks: [morning, afternoon] };
    // Two hours apart if the day allows; failing that, as far apart as it
    // allows, which is its last time, as long as that is not back to back.
    const last = onDay[onDay.length - 1];
    const second =
      apartFrom(onDay[0], onDay.slice(1), [Math.max(WELL_APART_MINUTES, input.minGapMinutes)]) ??
      (onDay.length > 1 ? apartFrom(onDay[0], [last], [input.minGapMinutes]) : undefined);
    // Only one time that day: it, and the soonest after it.
    return { kind: "choices", picks: second ? [onDay[0], second] : [onDay[0], ...later.slice(0, 1)] };
  }

  // Nothing on the day they named, or no day named: the two soonest.
  const pool = input.named ? later : slots;
  if (pool.length === 0) return { kind: "none", picks: [] };
  const second = apartFrom(pool[0], pool.slice(1), minuteGap(input.minGapMinutes));
  return { kind: "choices", picks: second ? [pool[0], second] : [pool[0]] };
}

function byStart(a: TimeSlot, b: TimeSlot): number {
  return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
}

/** Well apart if possible, at least a service's length if not. */
function minuteGap(min: number): number[] {
  return [Math.max(WELL_APART_MINUTES, min), min];
}

/** The first slot after `first` that is at least one of the gaps away, tried in order. */
function apartFrom(first: TimeSlot, rest: TimeSlot[], gaps: number[]): TimeSlot | undefined {
  const t0 = new Date(first.start).getTime();
  for (const gap of gaps) {
    const found = rest.find((s) => new Date(s.start).getTime() - t0 >= gap * 60_000);
    if (found) return found;
  }
  return undefined;
}

function parseHhMm(value: string | null | undefined): number | null {
  const m = value ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}
