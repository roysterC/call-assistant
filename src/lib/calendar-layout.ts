/**
 * Geometry for the day view: where a booking sits in a stylist's column.
 *
 * The salon's timezone decides everything here, never the browser's. A tablet
 * on the front desk set to the wrong region must still draw two o'clock at two
 * o'clock, so every instant is read through `zonedParts` with the salon's zone
 * rather than through the local Date accessors.
 */

import { addCalendarDays, zonedParts } from "@/lib/business-hours";

/** The span the grid used to show every day, and still the default where no
 *  day's own span is given (dayWindow below works that out). */
export const WINDOW_START_HOUR = 8;
export const WINDOW_END_HOUR = 21;

/** Row height of the grid, and the step a click on empty space snaps to. */
export const SLOT_MINUTES = 15;

/**
 * Pixels per hour. Fifteen-minute rows need the room to be distinguishable,
 * and a short booking its time, name and service. Was 64, then 96; now 120
 * at the salon's request, so a half-hour booking (60px) has a line each for
 * its time, client and service, and a quarter-hour row is 30px.
 */
export const HOUR_HEIGHT_PX = 120;

/** On a phone, where a row is also a thumb's target. Kept at 96 when the
 *  desktop grid grew: taller would mean scrolling a long way through a day. */
export const PHONE_HOUR_HEIGHT_PX = 96;

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

/** The stretch of a day the grid shows, in minutes past midnight. */
export interface DiaryWindow {
  startMin: number;
  endMin: number;
}

export const DEFAULT_WINDOW: DiaryWindow = { startMin: WINDOW_START_MIN, endMin: WINDOW_END_MIN };

/** Room either side of opening hours, so opening and closing are not on the edge. */
export const WINDOW_MARGIN_MIN = 30;
/** How far "show earlier" and "show later" go: as far as a booking can be made (booking-details.tsx). */
export const EARLIEST_SHOWN_MIN = 6 * 60;
export const LATEST_SHOWN_MIN = 22 * 60;

const floorTo = (min: number, step: number) => Math.floor(min / step) * step;
const ceilTo = (min: number, step: number) => Math.ceil(min / step) * step;

/**
 * The stretch of one day the diary shows: its opening hours with half an hour
 * either side, stretched to take in anything booked outside them, plus any
 * extra hours someone asked to see.
 *
 * Each day is fitted to its own hours, so one late night does not hang three
 * hours of closed evening on every other day of the week. A day the salon is
 * shut shows its usual hours (`usual`), all of it shaded, so a booking can
 * still be made into it.
 */
export function dayWindow({
  open,
  usual,
  busy = [],
  earlierHours = 0,
  laterHours = 0,
}: {
  open: { openMin: number; closeMin: number } | null;
  /** The week's widest opening hours, for a day the salon is shut. */
  usual?: { openMin: number; closeMin: number } | null;
  /** What is on that day, as [start, end] minutes past midnight. */
  busy?: Array<[number, number]>;
  /** Hours asked for above and below the day, by "show earlier" and "show later". */
  earlierHours?: number;
  laterHours?: number;
}): DiaryWindow {
  const hours = open ?? usual ?? null;
  let start = hours ? hours.openMin - WINDOW_MARGIN_MIN : WINDOW_START_MIN;
  let end = hours ? hours.closeMin + WINDOW_MARGIN_MIN : WINDOW_END_MIN;
  for (const [a, b] of busy) {
    if (b <= a) continue;
    start = Math.min(start, a - WINDOW_MARGIN_MIN);
    end = Math.max(end, b + WINDOW_MARGIN_MIN);
  }
  start = floorTo(start, 30);
  end = ceilTo(end, 30);
  // Asked-for hours go no further than a booking can be made, but never cut
  // back what the day's own hours or bookings need.
  if (earlierHours > 0) start = Math.min(start, Math.max(EARLIEST_SHOWN_MIN, start - earlierHours * 60));
  if (laterHours > 0) end = Math.max(end, Math.min(LATEST_SHOWN_MIN, end + laterHours * 60));
  start = Math.max(0, start);
  end = Math.min(24 * 60, end);
  if (end - start < 60) end = Math.min(24 * 60, start + 60);
  return { startMin: start, endMin: end };
}

const minutesIn = (w: DiaryWindow) => w.endMin - w.startMin;

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
  timeZone: string,
  w: DiaryWindow = DEFAULT_WINDOW
): { topPct: number; heightPct: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const rawStart = minutesOfDay(startsAt, timeZone);
  let rawEnd = minutesOfDay(endsAt, timeZone);

  // An appointment finishing at or past midnight reads as a smaller number
  // than its start. Treat it as running to the end of the day.
  if (rawEnd <= rawStart) rawEnd = w.endMin;

  const start = Math.max(rawStart, w.startMin);
  const end = Math.min(rawEnd, w.endMin);

  // Entirely outside the window.
  if (end <= w.startMin || start >= w.endMin) return null;

  return {
    topPct: ((start - w.startMin) / minutesIn(w)) * 100,
    heightPct: ((end - start) / minutesIn(w)) * 100,
    clippedStart: rawStart < w.startMin,
    clippedEnd: rawEnd > w.endMin,
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
  timeZone: string,
  w: DiaryWindow = DEFAULT_WINDOW
): { topPct: number; heightPct: number } | null {
  const startsToday = isOnDate(start, date, timeZone);
  const endsToday = isOnDate(end, date, timeZone);
  const dayStart = wallTimeToUtc(date, "00:00", timeZone);
  // Not on this day at all.
  if (!startsToday && start > dayStart) return null;
  if (!endsToday && end <= dayStart) return null;

  const from = Math.max(startsToday ? minutesOfDay(start, timeZone) : 0, w.startMin);
  const to = Math.min(endsToday ? minutesOfDay(end, timeZone) : 24 * 60, w.endMin);
  if (to <= from) return null;
  return {
    topPct: ((from - w.startMin) / minutesIn(w)) * 100,
    heightPct: ((to - from) / minutesIn(w)) * 100,
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
  timeZone: string,
  w: DiaryWindow = DEFAULT_WINDOW
): PlacedBlock<T>[] {
  const placed: Array<PlacedBlock<T> & { startMin: number; endMin: number }> = [];

  const sorted = [...items].sort((a, b) => {
    const A = getRange(a).startsAt.getTime();
    const B = getRange(b).startsAt.getTime();
    return A - B;
  });

  for (const item of sorted) {
    const { startsAt, endsAt } = getRange(item);
    const geo = blockGeometry(startsAt, endsAt, timeZone, w);
    if (!geo) continue;

    const startMin = Math.max(minutesOfDay(startsAt, timeZone), w.startMin);
    const endMin = startMin + (geo.heightPct / 100) * minutesIn(w);

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
  // Midnight to midnight: 25 hours the day the clocks go back, 23 when they
  // go forward.
  const start = wallTimeToUtc(date, "00:00", timeZone);
  const end = wallTimeToUtc(addCalendarDays(date, 1), "00:00", timeZone);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Salon-local "YYYY-MM-DD" for an instant. */
export function salonDate(at: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(at, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Row index (0-based) for a click at `offsetRatio` down the grid. */
export function rowFromOffset(offsetRatio: number, w: DiaryWindow = DEFAULT_WINDOW): number {
  const rows = rowCount(w);
  const row = Math.floor(offsetRatio * rows);
  return Math.min(Math.max(row, 0), rows - 1);
}

/** Quarter-hour rows in a window. */
export function rowCount(w: DiaryWindow = DEFAULT_WINDOW): number {
  return minutesIn(w) / SLOT_MINUTES;
}

/** "HH:MM" for a row index, in the salon's own clock. */
export function timeOfRow(row: number, w: DiaryWindow = DEFAULT_WINDOW): string {
  const total = w.startMin + row * SLOT_MINUTES;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Hour labels down the time axis. */
export function hourMarks(w: DiaryWindow = DEFAULT_WINDOW): Array<{ hour: number; label: string; topPct: number }> {
  const out = [];
  for (let h = Math.ceil(w.startMin / 60); h * 60 <= w.endMin; h++) {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    out.push({
      hour: h,
      label: `${h12}${h < 12 || h === 24 ? "am" : "pm"}`,
      topPct: ((h * 60 - w.startMin) / minutesIn(w)) * 100,
    });
  }
  return out;
}

/** Quarter-hour lines down the grid; `major` marks the hour. */
export function quarterMarks(w: DiaryWindow = DEFAULT_WINDOW): Array<{
  minutes: number;
  topPct: number;
  major: boolean;
  half: boolean;
}> {
  const out = [];
  for (let m = w.startMin; m <= w.endMin; m += SLOT_MINUTES) {
    out.push({
      minutes: m,
      topPct: ((m - w.startMin) / minutesIn(w)) * 100,
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
  open: { openMin: number; closeMin: number } | null,
  w: DiaryWindow = DEFAULT_WINDOW
): Array<{ topPct: number; heightPct: number }> {
  if (!open) return [{ topPct: 0, heightPct: 100 }];

  const bands: Array<{ topPct: number; heightPct: number }> = [];
  const toPct = (min: number) => ((min - w.startMin) / minutesIn(w)) * 100;

  if (open.openMin > w.startMin) {
    bands.push({
      topPct: 0,
      heightPct: toPct(Math.min(open.openMin, w.endMin)),
    });
  }
  if (open.closeMin < w.endMin) {
    const top = toPct(Math.max(open.closeMin, w.startMin));
    bands.push({ topPct: top, heightPct: 100 - top });
  }
  return bands;
}

/** The shortest free stretch the diary points out: room for a trim. */
export const FREE_GAP_MIN = 30;

/**
 * The free stretches between `from` and `to` (minutes past midnight) that
 * nothing busy covers, each at least `min` long: where a stylist could take
 * another booking. `busy` may overlap and come in any order.
 */
export function freeGaps(
  busy: Array<[number, number]>,
  from: number,
  to: number,
  min = FREE_GAP_MIN
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = from;
  for (const [a, b] of busy.filter(([a, b]) => b > from && a < to).sort((x, y) => x[0] - y[0])) {
    if (a - at >= min) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (to - at >= min) out.push([at, to]);
  return out;
}
