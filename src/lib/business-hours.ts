/**
 * Salon opening hours, and the timezone arithmetic everything else depends on.
 *
 * `freebusy` tells you what is already booked; it does not tell you when the
 * salon is open. Both are needed to produce a bookable slot.
 *
 * Hours live on `OrganizationSettings.businessHours`. They are rendered into
 * the voice prompt AND enforced in the availability algorithm from this one
 * source, so the hours the agent speaks cannot drift from the hours the code
 * allows.
 */

export interface DayHours {
  /** 0 = Sunday ... 6 = Saturday, matching `Date.getDay()`. */
  day: number;
  closed: boolean;
  /** "HH:MM" 24h, in the organization's timezone. Ignored when closed. */
  open: string;
  close: string;
}

export type BusinessHours = DayHours[];

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// -------------------------------------------------------------------------
// Timezone
//
// Implemented with `Intl` rather than a date library: converting a wall-clock
// time in a named zone to a UTC instant is the only operation needed here, and
// the two-pass technique below stays correct across DST transitions (for
// Europe/London, late March and late October every year).
// -------------------------------------------------------------------------

/** Offset, in ms, that `timeZone` was from UTC at the given instant. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // Intl can emit "24" for midnight
    get("minute"),
    get("second")
  );
  return asUtc - at.getTime();
}

/**
 * Convert a wall-clock time in `timeZone` to the UTC instant it refers to.
 *
 * Two passes: the first uses the offset at the naive guess, the second
 * re-resolves using the offset at that corrected instant. That lands on the
 * right side of a DST boundary where a single pass would not.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let ts = naive - tzOffsetMs(new Date(naive), timeZone);
  ts = naive - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/** Calendar parts of `at` as observed in `timeZone`. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAY_SHORT.indexOf(get("weekday")),
  };
}

/** "YYYY-MM-DD" for an instant, as observed in `timeZone`. */
export function zonedDateString(at: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(at, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" without letting the host timezone shift the date. */
export function parseDateOnly(date: string): {
  year: number;
  month: number;
  day: number;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

// -------------------------------------------------------------------------
// Parsing / validation
// -------------------------------------------------------------------------

export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`Invalid time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Strict validator.
 *
 * `PUT /api/settings` accepts a broad payload, and this value now drives both
 * booking logic and generated prompt text. Returns `[]` for anything malformed
 * rather than throwing — a bad settings row must not take the phone line down,
 * and callers treat `[]` as "hours not configured", which is a safe state.
 */
export function parseBusinessHours(raw: unknown): BusinessHours {
  if (!Array.isArray(raw)) return [];
  const out: BusinessHours = [];
  const seen = new Set<number>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const day = Number(e.day);
    if (!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day)) continue;

    const closed = Boolean(e.closed);
    const open = String(e.open ?? "");
    const close = String(e.close ?? "");

    if (!closed) {
      if (!HHMM.test(open) || !HHMM.test(close)) continue;
      // No overnight trading — a salon that closes before it opens is a typo.
      if (toMinutes(open) >= toMinutes(close)) continue;
    }

    seen.add(day);
    out.push({
      day,
      closed,
      open: closed ? "" : open,
      close: closed ? "" : close,
    });
  }

  return out.sort((a, b) => a.day - b.day);
}

/** Reject anything Intl does not recognise as a zone. */
export function parseTimezone(raw: unknown, fallback = "Europe/London"): string {
  const tz = typeof raw === "string" ? raw.trim() : "";
  if (!tz) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

// -------------------------------------------------------------------------
// Queries
// -------------------------------------------------------------------------

export function hoursForWeekday(
  hours: BusinessHours,
  weekday: number
): DayHours | null {
  return hours.find((h) => h.day === weekday) ?? null;
}

/**
 * The open window on `date`, as UTC instants. Null when closed or unconfigured.
 */
export function openWindowFor(
  hours: BusinessHours,
  timeZone: string,
  date: string
): { start: Date; end: Date } | null {
  const { year, month, day } = parseDateOnly(date);
  // Midday avoids any DST edge when only the weekday is wanted.
  const noon = zonedWallTimeToUtc(year, month, day, 12, 0, timeZone);
  const { weekday } = zonedParts(noon, timeZone);

  const dh = hoursForWeekday(hours, weekday);
  if (!dh || dh.closed) return null;

  const openM = toMinutes(dh.open);
  const closeM = toMinutes(dh.close);
  return {
    start: zonedWallTimeToUtc(
      year,
      month,
      day,
      Math.floor(openM / 60),
      openM % 60,
      timeZone
    ),
    end: zonedWallTimeToUtc(
      year,
      month,
      day,
      Math.floor(closeM / 60),
      closeM % 60,
      timeZone
    ),
  };
}

export function isOpenAt(
  hours: BusinessHours,
  timeZone: string,
  at: Date
): boolean {
  const win = openWindowFor(hours, timeZone, zonedDateString(at, timeZone));
  if (!win) return false;
  return at >= win.start && at < win.end;
}

/**
 * The next time the salon is open, at or after `from`.
 *
 * Replaces the prompt's hand-written "if it's late Saturday that means
 * Tuesday" rule and the old `new Date(date)` guessing in `handleBookCallback`.
 * Returns null when hours are unconfigured or every day is closed.
 */
export function nextOpenMorning(
  hours: BusinessHours,
  timeZone: string,
  from: Date = new Date()
): Date | null {
  if (hours.length === 0) return null;

  for (let offset = 0; offset < 14; offset++) {
    const probe = new Date(from.getTime() + offset * 24 * 60 * 60 * 1000);
    const win = openWindowFor(hours, timeZone, zonedDateString(probe, timeZone));
    if (!win) continue;
    if (win.start >= from) return win.start;
    // Opening time already passed; if the salon is still open, "next" is now.
    if (from < win.end) return from;
  }
  return null;
}

/**
 * Human-readable hours for the voice prompt, rendered at sync time so the
 * spoken hours and the enforced hours come from the same row.
 */
export function describeHoursForPrompt(
  hours: BusinessHours,
  timeZone: string
): string {
  if (hours.length === 0) return "Opening hours are not configured.";
  const lines: string[] = [];
  // Monday-first reads more naturally than Sunday-first.
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const dh = hoursForWeekday(hours, day);
    if (!dh) continue;
    lines.push(
      dh.closed
        ? `- ${DAY_NAMES[day]} — closed`
        : `- ${DAY_NAMES[day]} — ${dh.open} to ${dh.close}`
    );
  }
  return `${lines.join("\n")}\n\nAll times ${timeZone}.`;
}

// -------------------------------------------------------------------------
// Spoken dates
// -------------------------------------------------------------------------

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Resolve what a caller said into a calendar date.
 *
 * Callers say "Thursday", not "2026-09-17", and the model has no dependable
 * way to know today's date — it will either guess or hand back the weekday
 * name. Doing this on the server means the answer comes from the salon's own
 * clock rather than the model's imagination.
 *
 * Returns null when the input cannot be resolved, so the caller can ask again
 * instead of booking an invented day.
 */
export function resolveSpokenDate(
  input: string | undefined,
  timeZone: string,
  now: Date = new Date()
): string | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (!text) return null;

  // Already a calendar date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const addDays = (n: number) =>
    zonedDateString(new Date(now.getTime() + n * 24 * 60 * 60 * 1000), timeZone);

  if (text === "today" || text === "tonight") return addDays(0);
  if (text === "tomorrow") return addDays(1);
  if (text === "day after tomorrow" || text === "the day after tomorrow") {
    return addDays(2);
  }

  // "thursday", "this thursday", "next thursday", "on thursday"
  const cleaned = text.replace(/^(on|this|next|coming)\s+/, "").trim();
  const target = WEEKDAY_NAMES[cleaned];
  if (target === undefined) return null;

  // Next occurrence strictly after today. Someone ringing an after-hours line
  // and saying "Thursday" on a Thursday evening means the following week; if
  // they meant today they would have said so.
  const todayWeekday = zonedParts(now, timeZone).weekday;
  let delta = (target - todayWeekday + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(delta);
}

/**
 * Describe an appointment time for a written message.
 *
 * Deliberately different from the phrasing used on a call: "quarter past two"
 * suits speech, "2:15pm" suits a text someone glances at. Relative wording is
 * used where it is unambiguous, because "tomorrow at 2pm" is checked against
 * memory far faster than a date is.
 */
export function describeAppointmentWhen(
  at: Date,
  timeZone: string,
  now: Date = new Date()
): string {
  const target = zonedDateString(at, timeZone);
  const today = zonedDateString(now, timeZone);
  const tomorrow = zonedDateString(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
    timeZone
  );

  const { hour, minute } = zonedParts(at, timeZone);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  const time =
    minute === 0
      ? `${h12}${suffix}`
      : `${h12}:${String(minute).padStart(2, "0")}${suffix}`;

  if (target === today) return `today at ${time}`;
  if (target === tomorrow) return `tomorrow at ${time}`;

  const dayName = DAY_NAMES[zonedParts(at, timeZone).weekday];
  const withinAWeek = at.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000;
  if (withinAWeek) return `${dayName} at ${time}`;

  const { day, month } = zonedParts(at, timeZone);
  const monthName = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][month - 1];
  return `${dayName} ${day} ${monthName} at ${time}`;
}
