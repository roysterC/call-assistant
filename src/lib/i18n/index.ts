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
 * A time of day as each language writes it: "2:15pm" in English, "14:15" in
 * Vietnamese, where the 24-hour clock is the norm.
 */
export function clockTime(at: Date, lang: Lang, timeZone: string): string {
  if (lang === "vi") {
    return at.toLocaleTimeString("vi-VN", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return at.toLocaleTimeString("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "");
}
