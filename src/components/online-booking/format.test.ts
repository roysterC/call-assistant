import { describe, expect, it } from "vitest";
import { brandStyle, dayLabel, durationText, icsFor, longDay, periodOf, timeText } from "./format";

const TZ = "Europe/London";

describe("format", () => {
  it("says times in the salon's timezone", () => {
    expect(timeText("2026-11-11T15:15:00Z", TZ)).toBe("3:15pm");
    expect(timeText("2026-07-01T09:00:00Z", TZ)).toBe("10am");
    expect(timeText("2026-11-11T00:30:00Z", TZ)).toBe("12:30am");
  });

  it("puts a time in the morning, afternoon or evening", () => {
    expect(periodOf("2026-11-11T11:45:00Z", TZ)).toBe("Morning");
    expect(periodOf("2026-11-11T12:00:00Z", TZ)).toBe("Afternoon");
    expect(periodOf("2026-11-11T17:00:00Z", TZ)).toBe("Evening");
  });

  it("names days relative to the salon's today", () => {
    const now = new Date("2026-11-11T10:00:00Z");
    expect(dayLabel("2026-11-11", TZ, now)).toEqual({ dow: "Today", date: "11" });
    expect(dayLabel("2026-11-13", TZ, now)).toEqual({ dow: "Fri", date: "13" });
    expect(longDay("2026-11-12", TZ, true, now)).toBe("Tomorrow, Thursday 12 November");
    expect(longDay("2026-11-17", TZ, true, now)).toBe("Tuesday 17 November");
  });

  it("writes durations briefly", () => {
    expect(durationText(45)).toBe("45 min");
    expect(durationText(60)).toBe("1 hr");
    expect(durationText(150)).toBe("2 hr 30");
  });

  it("keeps brand-coloured text readable on white", () => {
    const dark = brandStyle("#9d3b5e") as Record<string, string>;
    expect(dark["--brand-ink"]).toBe("#9d3b5e");
    expect(dark["--brand-fg"]).toBe("#ffffff");
    const pale = brandStyle("#f5d0e0") as Record<string, string>;
    expect(pale["--brand-ink"]).toBe("#1c1917");
    expect(pale["--brand-fg"]).not.toBe("#ffffff");
  });

  it("makes a calendar file in UTC with its text escaped", () => {
    const ics = icsFor({
      start: "2026-11-11T15:15:00.000Z",
      durationMinutes: 60,
      title: "Cut, blow dry; Maison",
      location: "47 Bridge St\nTown",
    });
    expect(ics).toContain("DTSTART:20261111T151500Z");
    expect(ics).toContain("DTEND:20261111T161500Z");
    expect(ics).toContain("SUMMARY:Cut\\, blow dry\\; Maison");
    expect(ics).toContain("LOCATION:47 Bridge St\\nTown");
  });
});
