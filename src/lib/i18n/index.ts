/**
 * The CRM in many languages: English, and whichever others are added.
 *
 * Each person chooses (Account, or the flags on every screen); the choice
 * lives on their user record and in the kikai-lang cookie, so the server
 * renders the right language from the first byte. The words come from
 * next-intl (src/components/providers/language-provider.tsx): one file per
 * language, messages/<code>.json, English the master copy that every other
 * is checked against (i18n.test.ts). A phrase missing from a language is
 * shown in English.
 *
 * Phrases are ICU messages: {name} fills a blank, and plurals and the like
 * are written in the phrase ("{n, plural, one {# day} other {# days}}"), so
 * a language with three forms of a plural can have all three.
 *
 * What is translated: the staff app. Texts to clients, the phone
 * receptionist and messages from the server stay in English.
 *
 * Adding a language: its entry in LANGUAGE_INFO below, and its
 * messages/<code>.json (start from a copy of en.json). Its flag, if the
 * language switch should show one, goes in language-flags.tsx.
 */

import { enGB, vi } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";

/** Each language the CRM is offered in, and how it writes dates and times. */
export const LANGUAGE_INFO = {
  en: { name: "English", intl: "en-GB", clock: "12h", dateFns: enGB },
  vi: { name: "Tiếng Việt", intl: "vi-VN", clock: "24h", dateFns: vi },
} as const satisfies Record<string, { name: string; intl: string; clock: "12h" | "24h"; dateFns: DateFnsLocale }>;

export type Lang = keyof typeof LANGUAGE_INFO;
export const LANGUAGE_CODES = Object.keys(LANGUAGE_INFO) as Lang[];
export const LANGUAGES = Object.fromEntries(LANGUAGE_CODES.map((l) => [l, LANGUAGE_INFO[l].name])) as Record<Lang, string>;
export const DEFAULT_LANG: Lang = "en";
export const LANG_COOKIE = "kikai-lang";

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(LANGUAGE_INFO, v);
}

/** For date-fns's format(): month and day names in the reader's language. */
export const DATE_FNS_LOCALE = Object.fromEntries(LANGUAGE_CODES.map((l) => [l, LANGUAGE_INFO[l].dateFns])) as Record<Lang, DateFnsLocale>;

/** For Intl and toLocale*String: dates and numbers as each language writes them. */
export const INTL_LOCALE = Object.fromEntries(LANGUAGE_CODES.map((l) => [l, LANGUAGE_INFO[l].intl])) as Record<Lang, string>;

/** Every phrase, as English has them: the shape every language follows. */
export type Messages = typeof import("./messages/en.json");

/** "clients.title": the dotted path to one phrase. */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

/**
 * The blanks as the phrase wants them. A number in a plain blank goes in as
 * written ("Booking #1043", not ICU's "#1,043"); one the phrase counts with
 * ({n, plural, …}) or formats ({n, number}) stays a number.
 */
export function blanks(raw: string, vars: Vars | undefined): Vars | undefined {
  if (!vars) return vars;
  const out: Vars = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = typeof v === "number" && !new RegExp(`\\{\\s*${k}\\s*,`).test(raw) ? String(v) : v;
  }
  return out;
}

/**
 * The clock a person reads times on: "2:15pm" or "14:15". Each chooses
 * (Account); until they do it follows their language, 12-hour for English
 * and 24-hour for Vietnamese, where that is the norm. Kept in the kikai-clock
 * cookie as well as on their user record, like the language.
 */
export type Clock = "12h" | "24h";
export const CLOCK_COOKIE = "kikai-clock";

export function isClock(v: unknown): v is Clock {
  return v === "12h" || v === "24h";
}

export function defaultClock(lang: Lang): Clock {
  return LANGUAGE_INFO[lang].clock;
}

/**
 * Minutes past midnight on `clock`: "2:15pm" and "9:00am", or "14:15" and
 * "9:00". `suffix: false` leaves am and pm off, where the hours beside the
 * time already say which (the diary).
 */
export function minutesTime(min: number, clock: Clock, suffix = true): string {
  const h = Math.floor(min / 60) % 24;
  const m = String(min % 60).padStart(2, "0");
  if (clock === "24h") return `${h}:${m}`;
  return `${h % 12 || 12}:${m}${suffix ? (h < 12 ? "am" : "pm") : ""}`;
}

/** An instant's time of day in `timeZone`, on `clock`. */
export function clockTime(at: Date, clock: Clock, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return minutesTime(part("hour") * 60 + part("minute"), clock);
}

/**
 * "Tue 24 Nov, 2:30pm" (or "Tuesday 24 November, 2:30pm" when `long`): a day
 * and time in `timeZone`, on the person's own 12- or 24-hour `clock`, never
 * the browser's.
 */
export function dateClockTime(
  at: Date,
  clock: Clock,
  timeZone: string,
  locale: string,
  opts: { long?: boolean; weekday?: boolean } = {}
): string {
  const size = opts.long ? "long" : "short";
  const day = at.toLocaleDateString(locale, {
    timeZone,
    ...(opts.weekday === false ? {} : { weekday: size }),
    day: "numeric",
    month: size,
  });
  return `${day}, ${clockTime(at, clock, timeZone)}`;
}
