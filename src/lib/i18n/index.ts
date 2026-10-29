/**
 * The CRM in more than one language: English, and Vietnamese for staff who
 * prefer it. Each person chooses (Account, or the login page); the choice
 * lives on their user record and in the kikai-lang cookie, so the server
 * renders the right language from the first byte.
 *
 * Translated so far: what staff use every day (the menu, login, Diary,
 * Clients, Callbacks, Dashboard, Account, booking alerts and the assistant's
 * panel). Other screens, messages from the server and everything clients
 * see (texts, the phone receptionist) are still English.
 *
 * Messages sit side by side, English then Vietnamese, in messages/*.ts: a
 * line missing either fails the type check, and whoever checks the
 * Vietnamese sees the English it renders.
 */

import { enGB, vi } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";
import { MESSAGES, type MessageKey } from "./messages";

export const LANGUAGES = { en: "English", vi: "Tiếng Việt" } as const;
export type Lang = keyof typeof LANGUAGES;
export const DEFAULT_LANG: Lang = "en";
export const LANG_COOKIE = "kikai-lang";

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && v in LANGUAGES;
}

/** For date-fns's format(): month and day names in the reader's language. */
export const DATE_FNS_LOCALE: Record<Lang, DateFnsLocale> = { en: enGB, vi };

/** For Intl and toLocale*String: dates and numbers as each language writes them. */
export const INTL_LOCALE: Record<Lang, string> = { en: "en-GB", vi: "vi-VN" };

export type Vars = Record<string, string | number>;
export type Translate = (key: MessageKey, vars?: Vars) => string;

/** A message in `lang`, with {name} placeholders filled in. */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const text = MESSAGES[key][lang === "vi" ? 1 : 0];
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export type { MessageKey };

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
  return lang === "vi" ? "24h" : "12h";
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
