/**
 * Geometry for the day view: where a booking sits in a stylist's column.
 *
 * The salon's timezone decides everything here, never the browser's. A tablet
 * on the front desk set to the wrong region must still draw two o'clock at two
 * o'clock, so every instant is read through `zonedParts` with the salon's zone
 * rather than through the local Date accessors.
 */

import { zonedParts } from "@/lib/business-hours";

/** Fixed window for the grid. A salon trading 11-19 still wants to see the
 *  early delivery and the late tidy-up, and a fixed height stops the grid
 *  jumping about as you page between days with different opening hours. */
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 21;

/** Row height of the grid, and the step a click on empty space snaps to. */
export const SLOT_MINUTES = 15;

/** Pixels per hour. Fifteen-minute rows need the room to be distinguishable. */
export const HOUR_HEIGHT_PX = 64;

/**
 * Width kept clear on the right of every column, in pixels.
 *
 * Blocks never fill the column. The strip left over is always clickable, so a
 * stylist who is already booked at two o'clock can still be given a second
 * client at two o'clock — squeezing a regular in is a normal thing for a
 * salon to do, and the screen has to let them say it.
 */
export const OVERBOOK_GUTTER_PX = 22;

export const WINDOW_START_MIN = WINDOW_START_HOUR * 60;
export const WINDOW_END_MIN = WINDOW_END_HOUR * 60;
export const WINDOW_MINUTES = WINDOW_END_MIN - WINDOW_START_MIN;
export const ROW_COUNT = WINDOW_MINUTES / SLOT_MINUTES;

export interface PlacedBlock<T> {
  item: T;
  /** Percentages of the column, so the grid scales with its container. */
  topPct: number;
  heightPct: number;
  /** Which sub-column, when bookings overlap. 0-indexed. */
  lane: number;
  /** How many lanes this cluster needs, so width is `100 / lanes`. */
  lanes: number;
  /** True when the booking runs outside the window and has been clipped. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Minutes past midnight, as observed in `timeZone`. */
export function minutesOfDay(at: Date, timeZone: string): number {
  const { hour, minute } = zonedParts(at, timeZone);
  return hour * 60 + minute;
}

/**
 * Whether an instant falls on `date` ("YYYY-MM-DD") in the salon's zone.
 *
 * Compared as date strings rather than by arithmetic: a day is not always 24
 * hours long, and the clocks change twice a year in London.
 */
export function isOnDate(at: Date, date: string, timeZone: string): boolean {
  const { year, month, day } = zonedParts(at, timeZone);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso === date;
}

/**
 * Position one booking in the window.
 *
 * A booking that starts before the window opens or runs past its end is
 * clipped rather than dropped — a colour that overruns closing time still has
 * to be visible, and the flags let the caller mark the cut edge.
 */
export function blockGeometry(
  startsAt: Date,
  endsAt: Date,
  timeZone: string
): { topPct: number; heightPct: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const rawStart = minutesOfDay(startsAt, timeZone);
  let rawEnd = minutesOfDay(endsAt, timeZone);

  // An appointment finishing at or past midnight reads as a smaller number
  // than its start. Treat it as running to the end of the day.
  if (rawEnd <= rawStart) rawEnd = WINDOW_END_MIN;

  const start = Math.max(rawStart, WINDOW_START_MIN);
  const end = Math.min(rawEnd, WINDOW_END_MIN);

  // Entirely outside the window.
  if (end <= WINDOW_START_MIN || start >= WINDOW_END_MIN) return null;

  return {
    topPct: ((start - WINDOW_START_MIN) / WINDOW_MINUTES) * 100,
    heightPct: ((end - start) / WINDOW_MINUTES) * 100,
    clippedStart: rawStart < WINDOW_START_MIN,
    clippedEnd: rawEnd > WINDOW_END_MIN,
  };
}

/**
 * Position a stretch of time that may run across days — a holiday, a closed
 * week — on the one day shown. The part before this day and the part after
 * are cut off; what is left is clipped to the window like a booking.
 */
export function spanGeometry(
  start: Date,
  end: Date,
  date: string,
  timeZone: string
): { topPct: number; heightPct: number } | null {
  const startsToday = isOnDate(start, date, timeZone);
  const endsToday = isOnDate(end, date, timeZone);
  const dayStart = wallTimeToUtc(date, "00:00", timeZone);
  // Not on this day at all.
  if (!startsToday && start > dayStart) return null;
  if (!endsToday && end <= dayStart) return null;

  const from = Math.max(startsToday ? minutesOfDay(start, timeZone) : 0, WINDOW_START_MIN);
  const to = Math.min(endsToday ? minutesOfDay(end, timeZone) : 24 * 60, WINDOW_END_MIN);
  if (to <= from) return null;
  return {
    topPct: ((from - WINDOW_START_MIN) / WINDOW_MINUTES) * 100,
    heightPct: ((to - from) / WINDOW_MINUTES) * 100,
  };
}

/**
 * Lay out one stylist's bookings, side by side where they overlap.
 *
 * Two bookings on one stylist at one time should not happen, but data gets
 * that way — an import, a double entry, a cancellation that did not save.
 * Stacking them invisibly is the worst outcome, because the salon cannot see
 * the problem they need to fix. Overlapping bookings therefore share the
 * column rather than hiding one another.
 */
export function layoutColumn<T>(
  items: T[],
  getRange: (item: T) => { startsAt: Date; endsAt: Date },
  timeZone: string
): PlacedBlock<T>[] {
  const placed: Array<PlacedBlock<T> & { startMin: number; endMin: number }> = [];

  const sorted = [...items].sort((a, b) => {
    const A = getRange(a).startsAt.getTime();
    const B = getRange(b).startsAt.getTime();
    return A - B;
  });

  for (const item of sorted) {
    const { startsAt, endsAt } = getRange(item);
    const geo = blockGeometry(startsAt, endsAt, timeZone);
    if (!geo) continue;

    const startMin = Math.max(minutesOfDay(startsAt, timeZone), WINDOW_START_MIN);
    const endMin = startMin + (geo.heightPct / 100) * WINDOW_MINUTES;

    // Lowest lane free for this span.
    const taken = new Set(
      placed.filter((p) => p.startMin < endMin && startMin < p.endMin).map((p) => p.lane)
    );
    let lane = 0;
    while (taken.has(lane)) lane++;

    placed.push({ item, ...geo, lane, lanes: 1, startMin, endMin });
  }

  // Widen every block in a run of mutual overlaps to the same lane count, so
  // neighbours line up instead of each block guessing its own width.
  for (const block of placed) {
    const cluster = placed.filter(
      (p) => p.startMin < block.endMin && block.startMin < p.endMin
    );
    const lanes = Math.max(...cluster.map((p) => p.lane)) + 1;
    block.lanes = Math.max(block.lanes, lanes);
  }

  return placed.map((p) => ({
    item: p.item,
    topPct: p.topPct,
    heightPct: p.heightPct,
    lane: p.lane,
    lanes: p.lanes,
    clippedStart: p.clippedStart,
    clippedEnd: p.clippedEnd,
  }));
}

/**
 * The UTC instant of a wall-clock time in the salon's zone.
 *
 * Reads the guessed instant back through the zone and corrects by whatever
 * offset it reports. One correction covers every real offset, the half hours
 * included, without pulling in a date library.
 */
export function wallTimeToUtc(
  date: string,
  time: string,
  timeZone: string
): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);

  const seen = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guess));

  const get = (t: string) => Number(seen.find((p) => p.type === t)?.value);
  const seenUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute")
  );

  return new Date(guess - (seenUtc - guess));
}

/**
 * The instants bounding a salon day, for querying by date.
 *
 * A day is not a UTC day. Asking the API for midnight-to-midnight UTC drops
 * the tail of the salon's evening wherever the offset is negative, and pulls
 * in the previous evening as well — bookings that would then be drawn on the
 * wrong day, because the grid places a block by its time of day.
 */
export function salonDayRange(
  date: string,
  timeZone: string
): { from: string; to: string } {
  const start = wallTimeToUtc(date, "00:00", timeZone);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Salon-local "YYYY-MM-DD" for an instant. */
export function salonDate(at: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(at, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Row index (0-based) for a click at `offsetRatio` down the grid. */
export function rowFromOffset(offsetRatio: number): number {
  const row = Math.floor(offsetRatio * ROW_COUNT);
  return Math.min(Math.max(row, 0), ROW_COUNT - 1);
}

/** "HH:MM" for a row index, in the salon's own clock. */
export function timeOfRow(row: number): string {
  const total = WINDOW_START_MIN + row * SLOT_MINUTES;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Hour labels down the time axis. */
export function hourMarks(): Array<{ hour: number; label: string; topPct: number }> {
  const out = [];
  for (let h = WINDOW_START_HOUR; h <= WINDOW_END_HOUR; h++) {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out.push({
      hour: h,
      label: `${h12}${h < 12 ? "am" : "pm"}`,
      topPct: ((h * 60 - WINDOW_START_MIN) / WINDOW_MINUTES) * 100,
    });
  }
  return out;
}

/** Quarter-hour lines down the grid; `major` marks the hour. */
export function quarterMarks(): Array<{
  minutes: number;
  topPct: number;
  major: boolean;
  half: boolean;
}> {
  const out = [];
  for (let m = WINDOW_START_MIN; m <= WINDOW_END_MIN; m += SLOT_MINUTES) {
    out.push({
      minutes: m,
      topPct: ((m - WINDOW_START_MIN) / WINDOW_MINUTES) * 100,
      major: m % 60 === 0,
      half: m % 60 === 30,
    });
  }
  return out;
}

/**
 * The shaded band outside opening hours, as percentages of the window.
 *
 * Returns null when the salon is open for the whole window, and the full
 * height when it is shut, so a closed day reads as closed at a glance rather
 * than as an empty one anybody might book into.
 */
export function closedBands(
  open: { openMin: number; closeMin: number } | null
): Array<{ topPct: number; heightPct: number }> {
  if (!open) return [{ topPct: 0, heightPct: 100 }];

  const bands: Array<{ topPct: number; heightPct: number }> = [];
  const toPct = (min: number) => ((min - WINDOW_START_MIN) / WINDOW_MINUTES) * 100;

  if (open.openMin > WINDOW_START_MIN) {
    bands.push({
      topPct: 0,
      heightPct: toPct(Math.min(open.openMin, WINDOW_END_MIN)),
    });
  }
  if (open.closeMin < WINDOW_END_MIN) {
    const top = toPct(Math.max(open.closeMin, WINDOW_START_MIN));
    bands.push({ topPct: top, heightPct: 100 - top });
  }
  return bands;
}
