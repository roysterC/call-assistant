import { describe, expect, it } from "vitest";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { clockTime, dateClockTime, defaultClock, isClock, isLang, LANGUAGE_CODES, minutesTime } from ".";
import { translate } from "./server";
import { messagesFor } from "./load";
import { pseudoMessages, pseudoPhrase } from "./pseudo";
import en from "./messages/en.json";
import vi from "./messages/vi.json";

/** Each language's own file, as written (no English filled in). */
const FILES: Record<string, unknown> = { en, vi };

/** "a.b.c" → phrase, for every phrase in a file. */
function flat(node: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === "string") out.set(prefix + k, v);
    else flat(v, `${prefix}${k}.`, out);
  }
  return out;
}

/** The blanks a phrase has, by name: what every translation must keep. */
function blanksOf(message: string): string[] {
  const names = new Set<string>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if (el.type === TYPE.literal || el.type === TYPE.pound) continue;
      names.add(el.value);
      if (el.type === TYPE.plural || el.type === TYPE.select) for (const o of Object.values(el.options)) walk(o.value);
      if (el.type === TYPE.tag) walk(el.children);
    }
  };
  walk(parse(message, { ignoreTag: true }));
  return [...names].sort();
}

const english = flat(en);

// Words that are the same in both, or names that stay English on purpose.
// Brand names stay as they are.
const SAME_IN_BOTH = new Set(["Email", "OK", "Menu", "AI CRM", "Instagram", "Messenger", "WhatsApp", "Kikai: "]);

describe("the CRM's languages", () => {
  it("has a file for every language, and nothing in one that English lacks", () => {
    for (const lang of LANGUAGE_CODES) {
      expect(FILES[lang], lang).toBeDefined();
      const extra = [...flat(FILES[lang]).keys()].filter((k) => !english.has(k));
      expect(extra, lang).toEqual([]);
    }
  });

  it("has every phrase in every language, with the same blanks to fill as the English", () => {
    for (const lang of LANGUAGE_CODES) {
      const theirs = flat(FILES[lang]);
      for (const [key, phrase] of english) {
        const t = theirs.get(key);
        expect(typeof t, `${lang} ${key}`).toBe("string");
        // Empty only where English is (a line English readers do not need).
        if (phrase) expect(t, `${lang} ${key}`).not.toBe("");
        expect(blanksOf(t!), `${lang} ${key}`).toEqual(blanksOf(phrase));
      }
    }
  });

  it("has nothing left in English by mistake", () => {
    for (const lang of LANGUAGE_CODES.filter((l) => l !== "en")) {
      const theirs = flat(FILES[lang]);
      const untranslated = [...english].filter(([k, phrase]) => theirs.get(k) === phrase && !SAME_IN_BOTH.has(phrase)).map(([k]) => k);
      expect(untranslated, lang).toEqual([]);
    }
  });

  it("fills in the blanks, in the chosen language", () => {
    expect(translate("en", "alerts.minAgo", { n: 5 })).toBe("5 min ago");
    expect(translate("vi", "alerts.minAgo", { n: 5 })).toBe("5 phút trước");
    // A blank with nothing to fill it stays visible rather than vanishing.
    expect(translate("en", "alerts.minAgo")).toBe("{n} min ago");
  });

  it("writes a number in a plain blank as it is, and counts with one in a plural", () => {
    expect(translate("en", "sheet.bookingNumber", { n: 1043 })).toBe("Booking #1043");
    expect(translate("en", "client.days", { n: 1 })).toBe("1 day");
    expect(translate("en", "client.days", { n: 3 })).toBe("3 days");
  });

  it("gives a language without a phrase the English one", () => {
    expect(Object.keys(messagesFor("vi"))).toEqual(Object.keys(en));
  });

  it("knows only the languages it has", () => {
    expect(isLang("vi")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });

  it("writes the time on either clock, in the salon's time zone", () => {
    const at = new Date("2026-10-27T14:15:00Z");
    expect(clockTime(at, "12h", "Europe/London")).toBe("2:15pm");
    expect(clockTime(at, "24h", "Europe/London")).toBe("14:15");
    // Summer time: an hour on from UTC.
    expect(clockTime(new Date("2026-07-01T08:05:00Z"), "24h", "Europe/London")).toBe("9:05");
    expect(clockTime(new Date("2026-07-01T23:30:00Z"), "12h", "Europe/London")).toBe("12:30am");
  });

  it("writes a day and time on the person's clock, not the browser's", () => {
    const at = new Date("2026-11-24T14:30:00Z");
    expect(dateClockTime(at, "12h", "Europe/London", "en-GB")).toBe("Tue 24 Nov, 2:30pm");
    expect(dateClockTime(at, "24h", "Europe/London", "en-GB")).toBe("Tue 24 Nov, 14:30");
    expect(dateClockTime(at, "12h", "Europe/London", "en-GB", { long: true })).toBe("Tuesday 24 November, 2:30pm");
    expect(dateClockTime(at, "12h", "Europe/London", "en-GB", { weekday: false })).toBe("24 Nov, 2:30pm");
  });

  it("writes minutes past midnight, with or without am and pm", () => {
    expect(minutesTime(12 * 60, "12h")).toBe("12:00pm");
    expect(minutesTime(9 * 60 + 30, "12h", false)).toBe("9:30");
    expect(minutesTime(17 * 60 + 45, "24h")).toBe("17:45");
  });

  it("follows the language until a clock is chosen", () => {
    expect(defaultClock("en")).toBe("12h");
    expect(defaultClock("vi")).toBe("24h");
    expect(isClock("24h")).toBe(true);
    expect(isClock("24")).toBe(false);
  });

  it("has an accented test language whose every phrase still fills in", () => {
    expect(pseudoPhrase("Clients")).toBe("[Çļîéñţš ··]");
    const pseudo = flat(pseudoMessages(messagesFor("en")));
    for (const [key, phrase] of english) {
      expect(blanksOf(pseudo.get(key)!), key).toEqual(blanksOf(phrase));
    }
  });
});
