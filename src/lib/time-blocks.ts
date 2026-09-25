/**
 * Time blocked out of the diary: lunch, holidays, training, closed days.
 *
 * Pure — no database — so the arithmetic that decides when a block actually
 * falls can be tested on its own. The part worth testing is the weekly rule:
 * "Tuesdays 1pm to 2pm" is a wall-clock time in the salon, so each week is
 * resolved in the salon's timezone and stays 1pm across the clock change,
 * where adding seven days of milliseconds would drift an hour.
 */

import {
  addCalendarDays,
  parseDateOnly,
  zonedDateString,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";

export type BlockRepeat = "none" | "weekly";

/** A block as stored. Mirrors the TimeBlock model. */
export interface TimeBlockRecord {
  id: string;
  stylistName: string | null;
  label: string;
  allDay: boolean;
  repeat: string;
  startsAt: Date | null;
  endsAt: Date | null;
  weekdays: number[];
  startTime: string | null;
  endTime: string | null;
  fromDate: string | null;
  untilDate: string | null;
  skipDates: string[];
}

/** One stretch of blocked time: a one-off block, or one week of a weekly one. */
export interface BlockOccurrence {
  blockId: string;
  stylistName: string | null;
  label: string;
  allDay: boolean;
  repeat: BlockRepeat;
  /** The salon date this stretch starts on; what "skip this week" removes. */
  date: string;
  start: Date;
  end: Date;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function weekdayOf(date: string): number {
  const { year, month, day } = parseDateOnly(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** "24:00" is the end of the day, which TIME alone would refuse. */
function isEndTime(value: string): boolean {
  return value === "24:00" || TIME.test(value);
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A wall-clock time on a salon date, "24:00" meaning the next midnight. */
function wallTime(date: string, hhmm: string, timeZone: string): Date {
  if (hhmm === "24:00") return wallTime(addCalendarDays(date, 1), "00:00", timeZone);
  const { year, month, day } = parseDateOnly(date);
  const [h, m] = hhmm.split(":").map(Number);
  return zonedWallTimeToUtc(year, month, day, h, m, timeZone);
}

/** Does this block keep `stylistName` out? A block for nobody keeps everyone out. */
export function blockApplies(
  occurrence: Pick<BlockOccurrence, "stylistName">,
  stylistName: string
): boolean {
  return (
    occurrence.stylistName === null ||
    occurrence.stylistName.toLowerCase() === stylistName.toLowerCase()
  );
}

/**
 * Every stretch of blocked time overlapping [from, to), earliest first.
 *
 * A weekly block whose end is at or before its start runs past midnight
 * (a late shift blocked 22:00 to 02:00), so the day before `from` is looked
 * at too, in case its stretch runs into the window.
 */
export function expandBlocks(
  blocks: TimeBlockRecord[],
  from: Date,
  to: Date,
  timeZone: string
): BlockOccurrence[] {
  const out: BlockOccurrence[] = [];

  for (const b of blocks) {
    const base = {
      blockId: b.id,
      stylistName: b.stylistName,
      label: b.label,
      allDay: b.allDay,
    };

    if (b.repeat !== "weekly") {
      if (!b.startsAt || !b.endsAt) continue;
      if (b.startsAt < to && b.endsAt > from) {
        out.push({
          ...base,
          repeat: "none",
          date: zonedDateString(b.startsAt, timeZone),
          start: b.startsAt,
          end: b.endsAt,
        });
      }
      continue;
    }

    if (!b.startTime || !b.endTime || !b.fromDate || b.weekdays.length === 0) continue;
    const overnight =
      b.endTime !== "24:00" && minutesOf(b.endTime) <= minutesOf(b.startTime);
    const skip = new Set(b.skipDates);

    const firstDate = zonedDateString(new Date(from.getTime() - DAY_MS), timeZone);
    const lastDate = zonedDateString(to, timeZone);
    for (let d = firstDate; d <= lastDate; d = addCalendarDays(d, 1)) {
      if (d < b.fromDate) continue;
      if (b.untilDate && d > b.untilDate) break;
      if (skip.has(d) || !b.weekdays.includes(weekdayOf(d))) continue;

      const start = wallTime(d, b.startTime, timeZone);
      const end = wallTime(overnight ? addCalendarDays(d, 1) : d, b.endTime, timeZone);
      if (start < to && end > from) {
        out.push({ ...base, repeat: "weekly", date: d, start, end });
      }
    }
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// -------------------------------------------------------------------------
// The form
// -------------------------------------------------------------------------

/**
 * What the block form sends, and what it is filled from when a block is
 * edited. Dates and times are the salon's wall clock, never instants: the
 * person filling it in means "Tuesday at 1pm here".
 */
export interface TimeBlockForm {
  stylistName: string | null;
  label: string;
  allDay: boolean;
  repeat: BlockRepeat;
  /** One-off: first and last day. */
  startDate: string;
  endDate: string;
  /** Unused when allDay. */
  startTime: string;
  endTime: string;
  /** Weekly only. */
  weekdays: number[];
  untilDate: string | null;
}

/** The stored columns for a block, ready to write. */
export type TimeBlockData = Omit<TimeBlockRecord, "id">;

const MAX_ONE_OFF_DAYS = 366;

/**
 * Check a form and turn it into stored columns.
 *
 * Refuses rather than guesses: a block that silently came out as the wrong
 * hour would let the phone book a client into someone's lunch.
 */
export function parseTimeBlockForm(
  raw: unknown,
  timeZone: string
): { ok: true; data: TimeBlockData } | { ok: false; error: string } {
  const f = (raw ?? {}) as Partial<Record<keyof TimeBlockForm, unknown>>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const label = str(f.label).slice(0, 60);
  if (!label) return { ok: false, error: "Give the block a label, e.g. Lunch." };

  const stylistName = str(f.stylistName) || null;
  const allDay = f.allDay === true;
  const repeat: BlockRepeat = f.repeat === "weekly" ? "weekly" : "none";
  const startTime = allDay ? "00:00" : str(f.startTime);
  const endTime = allDay ? "24:00" : str(f.endTime);

  if (!allDay && (!TIME.test(startTime) || !isEndTime(endTime))) {
    return { ok: false, error: "Start and end need to be times, e.g. 13:00." };
  }

  const startDate = str(f.startDate);
  if (!DATE.test(startDate)) return { ok: false, error: "Choose a start date." };

  const common = { stylistName, label, allDay, skipDates: [] as string[] };

  if (repeat === "weekly") {
    const weekdays = Array.isArray(f.weekdays)
      ? [...new Set(f.weekdays.map(Number))].filter((d) => d >= 0 && d <= 6).sort()
      : [];
    if (weekdays.length === 0) return { ok: false, error: "Pick at least one day." };
    if (startTime === endTime) {
      return { ok: false, error: "The block starts and ends at the same time." };
    }
    const untilDate = str(f.untilDate) || null;
    if (untilDate && (!DATE.test(untilDate) || untilDate < startDate)) {
      return { ok: false, error: "The end date is before the start date." };
    }
    return {
      ok: true,
      data: {
        ...common,
        repeat,
        startsAt: null,
        endsAt: null,
        weekdays,
        startTime,
        endTime,
        fromDate: startDate,
        untilDate,
      },
    };
  }

  const endDate = str(f.endDate) || startDate;
  if (!DATE.test(endDate) || endDate < startDate) {
    return { ok: false, error: "The end date is before the start date." };
  }
  const startsAt = wallTime(startDate, startTime, timeZone);
  const endsAt = allDay
    ? wallTime(endDate, "24:00", timeZone)
    : wallTime(endDate, endTime, timeZone);
  if (endsAt <= startsAt) return { ok: false, error: "The block ends before it starts." };
  if (endsAt.getTime() - startsAt.getTime() > MAX_ONE_OFF_DAYS * DAY_MS) {
    return { ok: false, error: "A block can be at most a year long." };
  }

  return {
    ok: true,
    data: {
      ...common,
      repeat,
      startsAt,
      endsAt,
      weekdays: [],
      startTime: null,
      endTime: null,
      fromDate: null,
      untilDate: null,
    },
  };
}

function hhmm(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Fill the form back in from a stored block, for editing. */
export function blockToForm(b: TimeBlockRecord, timeZone: string): TimeBlockForm {
  if (b.repeat === "weekly") {
    return {
      stylistName: b.stylistName,
      label: b.label,
      allDay: b.allDay,
      repeat: "weekly",
      startDate: b.fromDate ?? "",
      endDate: b.fromDate ?? "",
      startTime: b.allDay ? "09:00" : (b.startTime ?? ""),
      endTime: b.allDay ? "17:00" : (b.endTime ?? ""),
      weekdays: b.weekdays,
      untilDate: b.untilDate,
    };
  }
  const start = b.startsAt ?? new Date();
  const end = b.endsAt ?? start;
  return {
    stylistName: b.stylistName,
    label: b.label,
    allDay: b.allDay,
    repeat: "none",
    startDate: zonedDateString(start, timeZone),
    // An all-day block ends at the midnight after its last day.
    endDate: zonedDateString(b.allDay ? new Date(end.getTime() - 1) : end, timeZone),
    startTime: b.allDay ? "09:00" : hhmm(start, timeZone),
    endTime: b.allDay ? "17:00" : hhmm(end, timeZone),
    weekdays: [],
    untilDate: null,
  };
}
