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

/**
 * Step a YYYY-MM-DD date by whole calendar days.
 *
 * Calendar arithmetic, not instant arithmetic: adding 24 hours across a DST
 * boundary lands on the wrong day, and a forward search that skips or repeats
 * a day would offer the caller a slot on a day the salon is shut.
 */
export function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = parseDateOnly(date);
  const at = new Date(Date.UTC(year, month - 1, day));
  at.setUTCDate(at.getUTCDate() + days);
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
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

/**
 * The weekdays the salon actually trades, as 0-6.
 *
 * Returns [] when hours are unconfigured, which callers must read as "not
 * known" rather than "never open" — the difference between declining to
 * constrain something and constraining it to nothing.
 */
export function openWeekdays(hours: BusinessHours): number[] {
  return hours
    .filter((h) => !h.closed)
    .map((h) => h.day)
    .sort((a, b) => a - b);
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
  let text = input.trim().toLowerCase();
  if (!text) return null;

  // Already a calendar date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const addDays = (n: number) =>
    zonedDateString(new Date(now.getTime() + n * 24 * 60 * 60 * 1000), timeZone);
  const today = zonedParts(now, timeZone);

  // "Tuesday morning", "tomorrow first thing": the day is what matters here;
  // the time goes to the time field.
  text = text
    .replace(/[,!?]/g, " ")
    .replace(/\s+(in the\s+)?(morning|afternoon|evening|night|lunchtime|at lunch|first thing)$/, "")
    .replace(/^(on|for)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  text = ordinalWordsToDigits(text);

  if (text === "today" || text === "tonight") return addDays(0);
  if (text === "tomorrow" || text === "tomoz" || text === "tmrw") return addDays(1);
  if (text === "day after tomorrow" || text === "the day after tomorrow") {
    return addDays(2);
  }
  if (text === "a week today") return addDays(7);
  if (text === "a week tomorrow") return addDays(8);

  // "in two weeks", "in 3 days"
  const inN = /^in (a|an|one|two|three|four|five|six|\d{1,2}) (day|days|week|weeks)$/.exec(text);
  if (inN) {
    const n = COUNT_WORDS[inN[1]] ?? Number(inN[1]);
    return addDays(inN[2].startsWith("week") ? n * 7 : n);
  }

  // "Tuesday week", "a week on Tuesday", "Tuesday after next"
  const weekOn =
    /^(?:a )?week on (\w+)$/.exec(text) ?? /^(\w+) week$/.exec(text) ?? /^(\w+) after next$/.exec(text);
  if (weekOn && WEEKDAY_NAMES[weekOn[1]] !== undefined) {
    return addDays(daysUntil(WEEKDAY_NAMES[weekOn[1]], today.weekday) + 7);
  }

  // "thursday", "this thursday", "next thursday", "coming thursday"
  const cleaned = text.replace(/^(this|next|coming)\s+/, "").trim();
  const target = WEEKDAY_NAMES[cleaned];
  if (target !== undefined) return addDays(daysUntil(target, today.weekday));

  return resolveCalendarDate(text, today);
}

/**
 * Days from today to the next such weekday, strictly after today. Someone
 * ringing an after-hours line and saying "Thursday" on a Thursday evening
 * means the following week; if they meant today they would have said so.
 */
function daysUntil(target: number, todayWeekday: number): number {
  const delta = (target - todayWeekday + 7) % 7;
  return delta === 0 ? 7 : delta;
}

const WEEKDAY_WORD = `(${Object.keys(WEEKDAY_NAMES).join("|")})`;
/** "Saturday the 3rd of October", "3rd", "the 3rd", "3 Oct". */
const DAY_FIRST = new RegExp(`^(?:${WEEKDAY_WORD} )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?: of)?(?: (\\w+))?$`);
/** "October 3rd", "Saturday October the 3rd". */
const MONTH_FIRST = new RegExp(`^(?:${WEEKDAY_WORD} )?(\\w+) (?:the )?(\\d{1,2})(?:st|nd|rd|th)?$`);

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const ORDINAL_UNITS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

/** "the twenty-ninth" → "the 29th", so spoken and written dates take one path. */
function ordinalWordsToDigits(text: string): string {
  return text
    .replace(/\b(twenty|thirty)[- ](first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g, (_, tens, unit) =>
      `${(tens === "twenty" ? 20 : 30) + ORDINAL_UNITS[unit]}th`
    )
    .replace(
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/g,
      (w) => `${ORDINAL_UNITS[w]}th`
    );
}

/**
 * A date given by its day of the month: "the 3rd", "3rd of October",
 * "October 3rd", "Saturday the 3rd", "3/10" (day first, as in Britain).
 *
 * Without a month, the next such day: this month, or next month once it has
 * passed. Without a year, this year, unless that is well in the past, as when
 * "the 14th of January" is said in September. A weekday said alongside must
 * match, or null: "Friday the 3rd" when the 3rd is a Saturday is a question
 * to ask the caller, not a guess to make.
 */
function resolveCalendarDate(text: string, today: ZonedParts): string | null {
  let weekday: number | undefined;
  let day: number;
  let month: number | undefined;
  let year: number | undefined;

  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(text);
  if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    if (numeric[3]) year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
  } else {
    const m =
      DAY_FIRST.exec(text) ?? MONTH_FIRST.exec(text);
    if (!m) return null;
    const monthFirst = !/^\d/.test(m[2]);
    const [lead, dayText, monthText] = monthFirst ? [m[1], m[3], m[2]] : [m[1], m[2], m[3]];
    if (lead !== undefined) {
      weekday = WEEKDAY_NAMES[lead];
      if (weekday === undefined) return null;
    }
    day = Number(dayText);
    if (monthText !== undefined) {
      month = MONTHS[monthText];
      if (month === undefined) return null;
    }
  }

  let resolved: string | null;
  if (month === undefined) {
    // This month, or next once the day has gone by.
    const rollover = day < today.day;
    const m = rollover ? (today.month % 12) + 1 : today.month;
    const y = rollover && today.month === 12 ? today.year + 1 : today.year;
    resolved = calendarDate(y, m, day);
  } else {
    resolved = calendarDate(year ?? today.year, month, day);
    const todayText = calendarDate(today.year, today.month, today.day)!;
    // Long gone this year with no year said: they mean next year.
    if (resolved && year === undefined && resolved < todayText) {
      const gone = Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(today.year, month - 1, day);
      if (gone > 31 * 24 * 60 * 60 * 1000) resolved = calendarDate(today.year + 1, month, day);
    }
  }
  if (!resolved) return null;
  if (weekday !== undefined) {
    const [y, m, d] = resolved.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== weekday) return null;
  }
  return resolved;
}

/** "YYYY-MM-DD", or null for a day the month does not have. */
function calendarDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

// -------------------------------------------------------------------------
// Spoken times
// -------------------------------------------------------------------------

const HOUR_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MINUTE_WORDS: Record<string, number> = {
  "oh five": 5, five: 5, ten: 10, fifteen: 15, twenty: 20, "twenty five": 25,
  thirty: 30, "thirty five": 35, forty: 40, "forty five": 45, fifty: 50,
  "fifty five": 55,
};

/** "five", "ten", "twenty-five" before "past"/"to". */
const PAST_TO_MINUTES: Record<string, number> = {
  five: 5, ten: 10, twenty: 20, "twenty five": 25, quarter: 15, "a quarter": 15,
};

/**
 * What a caller or model said about the time, as 24-hour "HH:MM".
 *
 * "2pm", "half two", "quarter to four", "nine thirty", "noon". Without an
 * am or pm, the hour is read the way a salon means it: eight to eleven in the
 * morning, one to seven in the afternoon. A time the salon cannot do (3am)
 * still comes back, so the booking can say why it is refused; only what is not
 * a time at all gives null.
 */
export function parseSpokenTime(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let t = String(input)
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/o'?clock/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  let period: "am" | "pm" | null = null;
  const periodMatch = /\s*(a\.?m\.?|p\.?m\.?|in the morning|in the afternoon|in the evening|at night|tonight)$/.exec(t);
  if (periodMatch) {
    period = /^\s*(a|in the morning)/.test(periodMatch[1]) ? "am" : "pm";
    t = t.slice(0, periodMatch.index).trim();
  }

  if (t === "noon" || t === "midday") return "12:00";
  if (t === "midnight") return "00:00";

  const hourOf = (w: string): number | undefined => (/^\d{1,2}$/.test(w) ? Number(w) : HOUR_WORDS[w]);
  // A written 24-hour time with a leading zero ("09:30") is already exact.
  let exact = false;
  let hour: number | undefined;
  let minute = 0;
  let minus = 0;

  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(t))) {
    hour = Number(m[1]);
    minute = m[2] ? Number(m[2]) : 0;
    exact = m[1].length === 2 && (m[1].startsWith("0") || hour > 12);
  } else if ((m = /^(\d{3,4})$/.exec(t))) {
    hour = Math.floor(Number(m[1]) / 100);
    minute = Number(m[1]) % 100;
    exact = m[1].length === 4;
  } else if ((m = /^half (?:past )?(\w+)$/.exec(t))) {
    // British: "half two" is half past two.
    hour = hourOf(m[1]);
    minute = 30;
  } else if ((m = /^(a quarter|quarter|five|ten|twenty|twenty five|\d{1,2}) (past|to) (\w+)$/.exec(t))) {
    const mins = PAST_TO_MINUTES[m[1]] ?? Number(m[1]);
    hour = hourOf(m[3]);
    if (m[2] === "past") minute = mins;
    else minus = mins;
  } else if ((m = /^(\w+) (\w+(?: \w+)?)$/.exec(t))) {
    // "nine thirty", "two fifteen", "4 45"
    hour = hourOf(m[1]);
    const mins = /^\d{2}$/.test(m[2]) ? Number(m[2]) : MINUTE_WORDS[m[2]];
    if (mins === undefined) return null;
    minute = mins;
  } else if (HOUR_WORDS[t] !== undefined) {
    hour = HOUR_WORDS[t];
  }

  if (hour === undefined || !Number.isFinite(hour) || minute > 59) return null;
  if (period === "am") {
    if (hour > 12) return null;
    if (hour === 12) hour = 0;
  } else if (period === "pm") {
    if (hour > 12) return null;
    if (hour < 12) hour += 12;
  } else if (!exact && hour >= 1 && hour <= 7) {
    hour += 12;
  }
  if (hour > 23) return null;

  let total = hour * 60 + minute - minus;
  if (total < 0) total += 24 * 60;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
