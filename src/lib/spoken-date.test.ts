import { describe, expect, it } from "vitest";
import { resolveSpokenDate, zonedIsoString, zonedParts } from "./business-hours";

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

// A Monday late in September, so dates wrap into October.
const MONDAY = new Date("2026-09-28T10:00:00Z");

describe("resolveSpokenDate: what British callers actually say", () => {
  const r = (s: string) => resolveSpokenDate(s, TZ, MONDAY);

  it("takes a time of day on the end", () => {
    expect(r("tomorrow morning")).toBe("2026-09-29");
    expect(r("Thursday afternoon")).toBe("2026-10-01");
    expect(r("Saturday first thing")).toBe("2026-10-03");
  });

  it("understands a week on", () => {
    expect(r("Tuesday week")).toBe("2026-10-06");
    expect(r("a week on Tuesday")).toBe("2026-10-06");
    expect(r("Tuesday after next")).toBe("2026-10-06");
    expect(r("a week today")).toBe("2026-10-05");
    expect(r("a week tomorrow")).toBe("2026-10-06");
    expect(r("in two weeks")).toBe("2026-10-12");
    expect(r("in 3 days")).toBe("2026-10-01");
  });

  it("understands a day of the month, rolling into next month when it has passed", () => {
    expect(r("the 3rd")).toBe("2026-10-03");
    expect(r("29th")).toBe("2026-09-29");
    expect(r("the 28th")).toBe("2026-09-28"); // today
    expect(r("the third")).toBe("2026-10-03");
    expect(r("the twenty-ninth")).toBe("2026-09-29");
  });

  it("understands a month, either way round", () => {
    expect(r("3rd October")).toBe("2026-10-03");
    expect(r("the 3rd of October")).toBe("2026-10-03");
    expect(r("October 3rd")).toBe("2026-10-03");
    expect(r("3 Oct")).toBe("2026-10-03");
    expect(r("14th of January")).toBe("2027-01-14");
  });

  it("reads numeric dates the British way round", () => {
    expect(r("3/10")).toBe("2026-10-03");
    expect(r("03/10/2026")).toBe("2026-10-03");
    expect(r("3.10.26")).toBe("2026-10-03");
  });

  it("checks a weekday given with a date, and refuses a mismatch rather than guess", () => {
    expect(r("Saturday the 3rd")).toBe("2026-10-03");
    expect(r("Friday the 3rd")).toBeNull();
  });

  it("still refuses what is not a day", () => {
    expect(r("next week")).toBeNull();
    expect(r("the 32nd")).toBeNull();
    expect(r("31st of September")).toBeNull();
    expect(r("whenever")).toBeNull();
  });
});

// --- Times handed to the model, in the salon's own clock ---------------------


describe("zonedIsoString", () => {
  it("gives the time as the caller heard it, with the offset, in summer and winter", () => {
    // Quarter past one in the afternoon, British Summer Time.
    expect(zonedIsoString(new Date("2026-10-06T12:15:00.000Z"), "Europe/London")).toBe("2026-10-06T13:15:00+01:00");
    // After the clocks go back, the digits and UTC agree.
    expect(zonedIsoString(new Date("2026-11-03T13:15:00.000Z"), "Europe/London")).toBe("2026-11-03T13:15:00+00:00");
  });

  it("is the same instant, so the booking code reads it back unchanged", () => {
    const at = new Date("2026-10-06T12:15:00.000Z");
    expect(new Date(zonedIsoString(at, "Europe/London")).toISOString()).toBe(at.toISOString());
    expect(new Date(zonedIsoString(at, "America/St_Johns")).toISOString()).toBe(at.toISOString());
  });
});
