import { describe, expect, it } from "vitest";
import { MESSAGES } from "./messages";
import { clockTime, isLang, translate } from ".";

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

  it("writes the time as each language does", () => {
    const at = new Date("2026-10-27T14:15:00Z");
    expect(clockTime(at, "en", "Europe/London")).toBe("2:15pm");
    expect(clockTime(at, "vi", "Europe/London")).toBe("14:15");
  });
});
