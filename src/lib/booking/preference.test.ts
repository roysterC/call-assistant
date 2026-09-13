import { describe, expect, it } from "vitest";
import { filterSlotsByPreference, parseTimeOfDay } from "./availability";
import { zonedWallTimeToUtc } from "@/lib/business-hours";
import type { TimeSlot } from "./types";

const TZ = "Europe/London";

/** Slots at 09:00, 14:15 and 19:15 local on Thursday 2026-09-17. */
function slots(): TimeSlot[] {
  return [
    [9, 0],
    [14, 15],
    [19, 15],
  ].map(([h, m]) => {
    const start = zonedWallTimeToUtc(2026, 9, 17, h, m, TZ);
    return {
      start: start.toISOString(),
      end: new Date(start.getTime() + 45 * 60000).toISOString(),
      stylistName: "Jo",
    };
  });
}

const localHours = (out: TimeSlot[]) =>
  out.map((s) => {
    const d = new Date(s.start);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
  });

describe("filterSlotsByPreference", () => {
  it("returns everything when no preference is given", () => {
    expect(filterSlotsByPreference(slots(), TZ, {})).toHaveLength(3);
  });

  it("honours 'after 17:00' — the case that failed on a real call", () => {
    expect(localHours(filterSlotsByPreference(slots(), TZ, { after: "17:00" })))
      .toEqual(["19:15"]);
  });

  it("honours a before boundary", () => {
    expect(localHours(filterSlotsByPreference(slots(), TZ, { before: "12:00" })))
      .toEqual(["09:00"]);
  });

  it("maps times of day to sensible windows", () => {
    expect(localHours(filterSlotsByPreference(slots(), TZ, { timeOfDay: "morning" }))).toEqual(["09:00"]);
    expect(localHours(filterSlotsByPreference(slots(), TZ, { timeOfDay: "afternoon" }))).toEqual(["14:15"]);
    expect(localHours(filterSlotsByPreference(slots(), TZ, { timeOfDay: "evening" }))).toEqual(["19:15"]);
  });

  it("combines a time of day with an explicit boundary", () => {
    // Evening is 17:00 onwards, but nothing before 20:00 is acceptable.
    expect(filterSlotsByPreference(slots(), TZ, { timeOfDay: "evening", after: "20:00" })).toEqual([]);
  });

  it("returns empty rather than widening when nothing fits", () => {
    expect(filterSlotsByPreference(slots(), TZ, { after: "22:00" })).toEqual([]);
  });

  it("ignores a malformed boundary rather than dropping everything", () => {
    expect(filterSlotsByPreference(slots(), TZ, { after: "half five" })).toHaveLength(3);
  });
});

describe("parseTimeOfDay", () => {
  it("accepts the words a caller uses", () => {
    expect(parseTimeOfDay("Morning")).toBe("morning");
    expect(parseTimeOfDay("pm")).toBe("afternoon");
    expect(parseTimeOfDay("night")).toBe("evening");
  });

  it("returns undefined for anything else", () => {
    expect(parseTimeOfDay("whenever")).toBeUndefined();
    expect(parseTimeOfDay(undefined)).toBeUndefined();
  });
});
