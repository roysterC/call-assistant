/**
 * Free times for the online booking page, a week at a time.
 *
 * The slot engine (src/lib/booking/availability.ts) answers per stylist, so a
 * 10:00 free with both Jo and Sam is two slots. A client choosing "anyone"
 * wants one 10:00, so each start is kept once, with the stylist the engine
 * listed first: the same one the phone receptionist offers for that time.
 *
 * Plain code, no database.
 */

import {
  addCalendarDays,
  hoursForWeekday,
  parseDateOnly,
  zonedDateString,
  type BusinessHours,
} from "@/lib/business-hours";
import type { TimeSlot } from "@/lib/booking/types";

/** Days per page of the time picker. */
export const WINDOW_DAYS = 7;

export interface PublicSlot {
  /** ISO instant: what is sent back to book it. */
  start: string;
  /** Who the time is with; booked with them. */
  stylist: string | null;
}

export interface DaySlots {
  /** YYYY-MM-DD in the salon's timezone. */
  date: string;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** Closed: the salon is shut. Full: open, but nothing fits. */
  status: "open" | "full" | "closed";
  slots: PublicSlot[];
}

export interface SlotWindow {
  /** The first day shown, after clamping. */
  from: string;
  /** How many days to search from `from`: never past the last bookable day. */
  days: number;
  /** The last day a client may book online. */
  lastDate: string;
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  const da = parseDateOnly(a);
  const db = parseDateOnly(b);
  return Math.round(
    (Date.UTC(db.year, db.month - 1, db.day) - Date.UTC(da.year, da.month - 1, da.day)) / 86_400_000
  );
}

export function weekdayOf(date: string): number {
  const { year, month, day } = parseDateOnly(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Which days to show: from `requested` (or today), never before today and
 * never past the last day the salon takes online bookings for. Null when
 * there is nothing left to show.
 */
export function slotWindow(
  requested: string | null | undefined,
  maxDaysAhead: number,
  timeZone: string,
  now: Date = new Date()
): SlotWindow | null {
  const today = zonedDateString(now, timeZone);
  const lastDate = addCalendarDays(today, maxDaysAhead);
  let from = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : today;
  if (daysBetween(today, from) < 0) from = today;
  const left = daysBetween(from, lastDate) + 1;
  if (left <= 0) return null;
  return { from, days: Math.min(WINDOW_DAYS, left), lastDate };
}

/** The engine's slots as days, every day of the window present. */
export function groupSlotsByDay(
  slots: TimeSlot[],
  window: { from: string; days: number },
  timeZone: string,
  hours: BusinessHours
): DaySlots[] {
  const byDate = new Map<string, PublicSlot[]>();
  const seen = new Set<string>();
  const sorted = [...slots].sort((a, b) =>
    a.start !== b.start
      ? a.start < b.start
        ? -1
        : 1
      : (a.stylistName ?? "").localeCompare(b.stylistName ?? "")
  );
  for (const s of sorted) {
    if (seen.has(s.start)) continue;
    seen.add(s.start);
    const date = zonedDateString(new Date(s.start), timeZone);
    const list = byDate.get(date) ?? [];
    list.push({ start: s.start, stylist: s.stylistName ?? null });
    byDate.set(date, list);
  }

  const days: DaySlots[] = [];
  for (let i = 0; i < window.days; i++) {
    const date = addCalendarDays(window.from, i);
    const weekday = weekdayOf(date);
    const open = hoursForWeekday(hours, weekday);
    const list = byDate.get(date) ?? [];
    days.push({
      date,
      weekday,
      status: list.length > 0 ? "open" : !open || open.closed ? "closed" : "full",
      slots: list,
    });
  }
  return days;
}

/**
 * The free times nearest `wanted`, for "that time has just gone": closest in
 * time either side, which keeps them on the same day where it has any, and
 * listed in time order.
 */
export function nearestSlots(days: DaySlots[], wanted: string, count = 3): PublicSlot[] {
  const target = new Date(wanted).getTime();
  const all = days.flatMap((d) => d.slots).filter((s) => s.start !== wanted);
  return all
    .sort((a, b) => Math.abs(new Date(a.start).getTime() - target) - Math.abs(new Date(b.start).getTime() - target))
    .slice(0, count)
    .sort((a, b) => (a.start < b.start ? -1 : 1));
}
