import { describe, expect, it } from "vitest";
import { resolveSpokenDate, zonedParts } from "./business-hours";

const TZ = "Europe/London";
// A Sunday, so every weekday name resolves within the following week.
const SUNDAY = new Date("2026-09-13T20:00:00Z");

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return zonedParts(new Date(Date.UTC(y, m - 1, d, 12)), TZ).weekday;
}

describe("resolveSpokenDate", () => {
  it("passes a calendar date straight through", () => {
    expect(resolveSpokenDate("2026-09-17", TZ, SUNDAY)).toBe("2026-09-17");
  });

  it("handles today and tomorrow", () => {
    expect(resolveSpokenDate("today", TZ, SUNDAY)).toBe("2026-09-13");
    expect(resolveSpokenDate("tomorrow", TZ, SUNDAY)).toBe("2026-09-14");
  });

  it("resolves a weekday name to the next such day", () => {
    expect(resolveSpokenDate("Thursday", TZ, SUNDAY)).toBe("2026-09-17");
    expect(weekdayOf(resolveSpokenDate("Thursday", TZ, SUNDAY)!)).toBe(4);
  });

  it("accepts the phrasings a caller actually uses", () => {
    for (const phrase of ["thursday", "on Thursday", "this Thursday", "next thursday", "Thurs"]) {
      expect(resolveSpokenDate(phrase, TZ, SUNDAY)).toBe("2026-09-17");
    }
  });

  it("never returns today for a bare weekday name", () => {
    // Asked on a Sunday evening, "Sunday" means next Sunday, not tonight.
    expect(resolveSpokenDate("Sunday", TZ, SUNDAY)).toBe("2026-09-20");
  });

  it("returns null for anything it cannot resolve", () => {
    for (const junk of ["sometime", "whenever", "", undefined, "the 32nd"]) {
      expect(resolveSpokenDate(junk as string, TZ, SUNDAY)).toBeNull();
    }
  });
});
