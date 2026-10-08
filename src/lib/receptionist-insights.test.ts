import { describe, expect, it } from "vitest";
import { summariseReceptionist, type InsightCall } from "./receptionist-insights";
import type { BusinessHours } from "./business-hours";

const TZ = "Europe/London";
// Tue–Sat 09:00–17:00; Sunday and Monday closed.
const HOURS: BusinessHours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  closed: day === 0 || day === 1,
  open: "09:00",
  close: "17:00",
}));
// Wednesday 7 October 2026, 15:00 in London (BST, UTC+1).
const NOW = new Date("2026-10-07T14:00:00Z");

const call = (iso: string, outcomes: string[] = [], duration = 120): InsightCall => ({
  createdAt: new Date(iso),
  duration,
  outcomes,
});

const prices: Record<string, number> = { "cut and blow dry": 4500, "full head colour": 9500 };
const priceOf = (s: string) => prices[s.toLowerCase()] ?? null;

describe("summariseReceptionist", () => {
  const base = { bookings: [], callbacks: 0, priceOf, hours: HOURS, timeZone: TZ, days: 7, now: NOW };

  it("counts calls that arrived while the salon was closed", () => {
    const r = summariseReceptionist({
      ...base,
      calls: [
        call("2026-10-07T09:30:00Z"), // 10:30 Wed, open
        call("2026-10-06T19:00:00Z"), // 20:00 Tue, after closing
        call("2026-10-05T10:00:00Z"), // Monday, closed all day
        call("2026-10-07T07:30:00Z"), // 08:30 Wed, before opening
      ],
    });
    expect(r.totals.calls).toBe(4);
    expect(r.totals.whileClosed).toBe(3);
    expect(r.totals.whileClosedRate).toBe(75);
  });

  it("does not guess at closed calls when the hours are not set", () => {
    const r = summariseReceptionist({ ...base, hours: [], calls: [call("2026-10-05T10:00:00Z")] });
    expect(r.totals.whileClosed).toBeNull();
    expect(r.totals.whileClosedRate).toBeNull();
  });

  it("buckets days and hours in the salon's time zone", () => {
    // 23:30 UTC on the 6th is 00:30 on the 7th in London.
    const r = summariseReceptionist({ ...base, calls: [call("2026-10-06T23:30:00Z")] });
    expect(r.daily.find((d) => d.day === "2026-10-07")?.calls).toBe(1);
    expect(r.daily.find((d) => d.day === "2026-10-06")?.calls).toBe(0);
    expect(r.hourly[0].calls).toBe(1);
  });

  it("lists every day in the range, quiet ones as zero", () => {
    const r = summariseReceptionist({ ...base, calls: [] });
    expect(r.daily.map((d) => d.day)).toEqual([
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
    ]);
    expect(r.hourly).toHaveLength(24);
  });

  it("values bookings at list price and counts the ones without a price", () => {
    const r = summariseReceptionist({
      ...base,
      calls: [call("2026-10-07T09:30:00Z", ["booked"]), call("2026-10-07T10:30:00Z", ["enquiry"])],
      bookings: [
        { createdAt: new Date("2026-10-07T09:31:00Z"), serviceText: "Cut and blow dry" },
        { createdAt: new Date("2026-10-07T09:32:00Z"), serviceText: "Full head colour" },
        { createdAt: new Date("2026-10-07T09:33:00Z"), serviceText: "Something unlisted" },
      ],
    });
    expect(r.totals.bookings).toBe(3);
    expect(r.totals.bookedValueMinor).toBe(14000);
    expect(r.totals.unpricedBookings).toBe(1);
    expect(r.totals.bookingRate).toBe(50);
    expect(r.daily.find((d) => d.day === "2026-10-07")?.bookings).toBe(3);
  });

  it("ranks outcomes, counting each once per call", () => {
    const r = summariseReceptionist({
      ...base,
      calls: [
        call("2026-10-07T09:30:00Z", ["enquiry"]),
        call("2026-10-07T09:40:00Z", ["booked", "booked"]),
        call("2026-10-07T09:50:00Z", ["enquiry", "message"]),
      ],
    });
    expect(r.outcomes).toEqual([
      { outcome: "enquiry", count: 2 },
      { outcome: "booked", count: 1 },
      { outcome: "message", count: 1 },
    ]);
  });

  it("averages call length, and reads zero calls as zero", () => {
    expect(summariseReceptionist({ ...base, calls: [] }).totals.avgDurationSeconds).toBe(0);
    const r = summariseReceptionist({
      ...base,
      calls: [call("2026-10-07T09:30:00Z", [], 60), call("2026-10-07T09:40:00Z", [], 121)],
    });
    expect(r.totals.avgDurationSeconds).toBe(91);
  });
});
