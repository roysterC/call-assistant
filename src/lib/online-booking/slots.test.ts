import { describe, expect, it } from "vitest";
import { daysBetween, groupSlotsByDay, nearestSlots, slotWindow, weekdayOf, WINDOW_DAYS } from "./slots";
import { parseBusinessHours } from "@/lib/business-hours";
import type { TimeSlot } from "@/lib/booking/types";

const TZ = "Europe/London";
// Closed Sunday and Monday.
const HOURS = parseBusinessHours([
  { day: 0, closed: true },
  { day: 1, closed: true },
  { day: 2, closed: false, open: "09:00", close: "17:30" },
  { day: 3, closed: false, open: "09:00", close: "17:30" },
  { day: 4, closed: false, open: "09:00", close: "20:00" },
  { day: 5, closed: false, open: "09:00", close: "18:00" },
  { day: 6, closed: false, open: "08:30", close: "16:00" },
]);

// Wednesday 11 November 2026, 10:00 in London (GMT).
const NOW = new Date("2026-11-11T10:00:00Z");

const slot = (start: string, stylistName: string): TimeSlot => ({
  start,
  end: new Date(new Date(start).getTime() + 3600_000).toISOString(),
  stylistName,
});

describe("slotWindow", () => {
  it("starts today and shows a week", () => {
    expect(slotWindow(null, 56, TZ, NOW)).toEqual({ from: "2026-11-11", days: WINDOW_DAYS, lastDate: "2027-01-06" });
  });

  it("never starts before today", () => {
    expect(slotWindow("2026-11-01", 56, TZ, NOW)?.from).toBe("2026-11-11");
    expect(slotWindow("nonsense", 56, TZ, NOW)?.from).toBe("2026-11-11");
  });

  it("stops at the last day the salon takes online bookings for", () => {
    expect(slotWindow("2026-11-15", 7, TZ, NOW)).toEqual({ from: "2026-11-15", days: 4, lastDate: "2026-11-18" });
    expect(slotWindow("2026-11-19", 7, TZ, NOW)).toBeNull();
  });

  it("uses the salon's date, not UTC's, just after midnight in summer", () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London.
    expect(slotWindow(null, 7, TZ, new Date("2026-06-30T23:30:00Z"))?.from).toBe("2026-07-01");
  });
});

describe("groupSlotsByDay", () => {
  const window = { from: "2026-11-11", days: 7 };

  it("keeps each start once, with the first stylist the engine listed", () => {
    const days = groupSlotsByDay(
      [
        slot("2026-11-11T15:15:00.000Z", "Sam"),
        slot("2026-11-11T15:15:00.000Z", "Jo"),
        slot("2026-11-11T15:30:00.000Z", "Sam"),
      ],
      window,
      TZ,
      HOURS
    );
    expect(days[0].slots).toEqual([
      { start: "2026-11-11T15:15:00.000Z", stylist: "Jo" },
      { start: "2026-11-11T15:30:00.000Z", stylist: "Sam" },
    ]);
  });

  it("has every day of the window, saying which are closed and which are full", () => {
    const days = groupSlotsByDay([slot("2026-11-12T09:00:00.000Z", "Jo")], window, TZ, HOURS);
    expect(days.map((d) => [d.date, d.status])).toEqual([
      ["2026-11-11", "full"],
      ["2026-11-12", "open"],
      ["2026-11-13", "full"],
      ["2026-11-14", "full"],
      ["2026-11-15", "closed"],
      ["2026-11-16", "closed"],
      ["2026-11-17", "full"],
    ]);
  });

  it("puts a slot on the salon's day, not UTC's", () => {
    // 23:30 UTC on 1 July is 00:30 on 2 July in London.
    const days = groupSlotsByDay([slot("2026-07-01T23:30:00.000Z", "Jo")], { from: "2026-07-01", days: 2 }, TZ, HOURS);
    expect(days[0].slots).toEqual([]);
    expect(days[1].slots).toHaveLength(1);
  });
});

describe("nearestSlots", () => {
  it("offers the closest free times either side, in time order, not the one that went", () => {
    const days = groupSlotsByDay(
      [
        slot("2026-11-11T09:00:00.000Z", "Jo"),
        slot("2026-11-11T15:00:00.000Z", "Jo"),
        slot("2026-11-11T15:15:00.000Z", "Jo"),
        slot("2026-11-11T15:45:00.000Z", "Sam"),
        slot("2026-11-12T15:15:00.000Z", "Sam"),
      ],
      { from: "2026-11-11", days: 2 },
      TZ,
      HOURS
    );
    expect(nearestSlots(days, "2026-11-11T15:15:00.000Z").map((s) => s.start)).toEqual([
      "2026-11-11T09:00:00.000Z",
      "2026-11-11T15:00:00.000Z",
      "2026-11-11T15:45:00.000Z",
    ]);
  });
});

describe("date arithmetic", () => {
  it("counts days and weekdays", () => {
    expect(daysBetween("2026-11-11", "2026-11-18")).toBe(7);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(weekdayOf("2026-11-11")).toBe(3);
  });
});
