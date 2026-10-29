import { describe, expect, it } from "vitest";
import { MESSAGES } from "./messages";
import { clockTime, defaultClock, isClock, isLang, minutesTime, translate } from ".";

const entries = Object.entries(MESSAGES) as [keyof typeof MESSAGES, readonly [string, string]][];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Words that are the same in both, or names that stay English on purpose.
const SAME_IN_BOTH = new Set(["Email", "OK", "Menu", "AI CRM"]);

describe("the CRM's languages", () => {
  it("has every message in Vietnamese, with the same blanks to fill as the English", () => {
    for (const [key, [en, vi]] of entries) {
      expect(vi, key).not.toBe("");
      expect(placeholders(vi), key).toEqual(placeholders(en));
    }
  });

  it("has nothing left in English by mistake", () => {
    const untranslated = entries.filter(([, [en, vi]]) => en === vi && !SAME_IN_BOTH.has(en)).map(([k]) => k);
    expect(untranslated).toEqual([]);
  });

  it("fills in the blanks, in the chosen language", () => {
    expect(translate("en", "alerts.minAgo", { n: 5 })).toBe("5 min ago");
    expect(translate("vi", "alerts.minAgo", { n: 5 })).toBe("5 phút trước");
    // A blank with nothing to fill it stays visible rather than vanishing.
    expect(translate("en", "alerts.minAgo")).toBe("{n} min ago");
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
});
