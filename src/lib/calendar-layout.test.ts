import { describe, expect, it } from "vitest";
import {
  blockGeometry,
  closedBands,
  hourMarks,
  isOnDate,
  layoutColumn,
  minutesOfDay,
  rowFromOffset,
  salonDate,
  salonDayRange,
  quarterMarks,
  timeOfRow,
  wallTimeToUtc,
  ROW_COUNT,
  WINDOW_MINUTES,
} from "./calendar-layout";

const TZ = "Europe/London";

/** A UTC instant. London is +1 in summer, +0 in winter — which is the point. */
const at = (iso: string) => new Date(iso);

describe("minutesOfDay", () => {
  it("reads the salon's clock, not UTC", () => {
    // 13:00Z in September is 14:00 in London (BST).
    expect(minutesOfDay(at("2026-09-18T13:00:00Z"), TZ)).toBe(14 * 60);
  });

  it("and in winter, when London is UTC", () => {
    expect(minutesOfDay(at("2026-12-18T13:00:00Z"), TZ)).toBe(13 * 60);
  });
});

describe("isOnDate", () => {
  it("is true for an instant that falls on the day in the salon's zone", () => {
    expect(isOnDate(at("2026-09-18T13:00:00Z"), "2026-09-18", TZ)).toBe(true);
  });

  it("puts a late-evening BST booking on the right day", () => {
    // 23:30 London on the 18th is 22:30Z on the 18th.
    expect(isOnDate(at("2026-09-18T22:30:00Z"), "2026-09-18", TZ)).toBe(true);
  });

  it("does not claim the neighbouring day", () => {
    expect(isOnDate(at("2026-09-18T23:30:00Z"), "2026-09-18", TZ)).toBe(false);
  });
});

describe("blockGeometry", () => {
  it("places a mid-window booking proportionally", () => {
    // 11:00-12:00 London, window 08:00-21:00 (780 min).
    const g = blockGeometry(
      at("2026-09-18T10:00:00Z"),
      at("2026-09-18T11:00:00Z"),
      TZ
    )!;
    expect(g.topPct).toBeCloseTo(((11 * 60 - 8 * 60) / WINDOW_MINUTES) * 100, 5);
    expect(g.heightPct).toBeCloseTo((60 / WINDOW_MINUTES) * 100, 5);
    expect(g.clippedStart).toBe(false);
    expect(g.clippedEnd).toBe(false);
  });

  it("clips a booking that starts before the window opens", () => {
    // 07:00-09:00 London.
    const g = blockGeometry(
      at("2026-09-18T06:00:00Z"),
      at("2026-09-18T08:00:00Z"),
      TZ
    )!;
    expect(g.topPct).toBe(0);
    expect(g.clippedStart).toBe(true);
    expect(g.heightPct).toBeCloseTo((60 / WINDOW_MINUTES) * 100, 5);
  });

  it("clips a booking that runs past the window", () => {
    // 20:00-22:00 London.
    const g = blockGeometry(
      at("2026-09-18T19:00:00Z"),
      at("2026-09-18T21:00:00Z"),
      TZ
    )!;
    expect(g.clippedEnd).toBe(true);
    expect(g.topPct + g.heightPct).toBeCloseTo(100, 5);
  });

  it("returns null for a booking entirely outside the window", () => {
    // 05:00-06:00 London.
    expect(
      blockGeometry(at("2026-09-18T04:00:00Z"), at("2026-09-18T05:00:00Z"), TZ)
    ).toBeNull();
  });

  it("treats an end at or before the start as running to close", () => {
    const g = blockGeometry(
      at("2026-09-18T17:00:00Z"),
      at("2026-09-18T17:00:00Z"),
      TZ
    )!;
    expect(g.topPct + g.heightPct).toBeCloseTo(100, 5);
  });
});

describe("layoutColumn", () => {
  const range = (i: { startsAt: Date; endsAt: Date }) => i;

  it("gives sequential bookings a single lane each", () => {
    const items = [
      { startsAt: at("2026-09-18T10:00:00Z"), endsAt: at("2026-09-18T10:45:00Z") },
      { startsAt: at("2026-09-18T11:00:00Z"), endsAt: at("2026-09-18T11:45:00Z") },
    ];
    const out = layoutColumn(items, range, TZ);
    expect(out).toHaveLength(2);
    expect(out.every((b) => b.lane === 0 && b.lanes === 1)).toBe(true);
  });

  it("puts a genuine double-booking side by side rather than hiding one", () => {
    const items = [
      { startsAt: at("2026-09-18T10:00:00Z"), endsAt: at("2026-09-18T11:00:00Z") },
      { startsAt: at("2026-09-18T10:30:00Z"), endsAt: at("2026-09-18T11:30:00Z") },
    ];
    const out = layoutColumn(items, range, TZ);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.lane).sort()).toEqual([0, 1]);
    expect(out.every((b) => b.lanes === 2)).toBe(true);
  });

  it("reuses a lane once the overlap has passed", () => {
    const items = [
      { startsAt: at("2026-09-18T10:00:00Z"), endsAt: at("2026-09-18T11:00:00Z") },
      { startsAt: at("2026-09-18T10:30:00Z"), endsAt: at("2026-09-18T11:30:00Z") },
      { startsAt: at("2026-09-18T13:00:00Z"), endsAt: at("2026-09-18T13:30:00Z") },
    ];
    const out = layoutColumn(items, range, TZ);
    const last = out[out.length - 1];
    expect(last.lane).toBe(0);
    expect(last.lanes).toBe(1);
  });

  it("drops bookings that fall outside the window entirely", () => {
    const items = [
      { startsAt: at("2026-09-18T04:00:00Z"), endsAt: at("2026-09-18T05:00:00Z") },
    ];
    expect(layoutColumn(items, range, TZ)).toHaveLength(0);
  });
});

describe("click-to-time", () => {
  it("snaps the top of the grid to the window start", () => {
    expect(timeOfRow(rowFromOffset(0))).toBe("08:00");
  });

  it("snaps mid-grid to a quarter hour", () => {
    // Halfway down 08:00-21:00 is 14:30.
    expect(timeOfRow(rowFromOffset(0.5))).toBe("14:30");
  });

  it("clamps past the bottom to the last row, not past it", () => {
    expect(rowFromOffset(1)).toBe(ROW_COUNT - 1);
    expect(timeOfRow(rowFromOffset(1))).toBe("20:45");
  });

  it("clamps a negative offset to the first row", () => {
    expect(rowFromOffset(-0.4)).toBe(0);
  });
});

describe("hourMarks", () => {
  it("labels every hour in the window, in salon-speak", () => {
    const marks = hourMarks();
    expect(marks[0].label).toBe("8am");
    expect(marks[marks.length - 1].label).toBe("9pm");
    expect(marks.find((m) => m.hour === 12)!.label).toBe("12pm");
  });

  it("puts the first mark at the top and the last at the bottom", () => {
    const marks = hourMarks();
    expect(marks[0].topPct).toBe(0);
    expect(marks[marks.length - 1].topPct).toBeCloseTo(100, 5);
  });
});

describe("closedBands", () => {
  it("shades the whole window on a closed day", () => {
    expect(closedBands(null)).toEqual([{ topPct: 0, heightPct: 100 }]);
  });

  it("shades before opening and after closing", () => {
    // Open 11:00-19:00.
    const bands = closedBands({ openMin: 11 * 60, closeMin: 19 * 60 });
    expect(bands).toHaveLength(2);
    expect(bands[0].topPct).toBe(0);
    expect(bands[0].heightPct).toBeCloseTo((180 / WINDOW_MINUTES) * 100, 5);
    expect(bands[1].topPct + bands[1].heightPct).toBeCloseTo(100, 5);
  });

  it("shades nothing when the salon covers the whole window", () => {
    expect(closedBands({ openMin: 8 * 60, closeMin: 21 * 60 })).toHaveLength(0);
  });
});


describe("wallTimeToUtc", () => {
  it("resolves a BST wall time to the right instant", () => {
    // 14:00 London in September is 13:00Z.
    expect(wallTimeToUtc("2026-09-18", "14:00", TZ).toISOString()).toBe(
      "2026-09-18T13:00:00.000Z"
    );
  });

  it("resolves a GMT wall time to the right instant", () => {
    expect(wallTimeToUtc("2026-12-18", "14:00", TZ).toISOString()).toBe(
      "2026-12-18T14:00:00.000Z"
    );
  });

  it("handles a zone with a negative offset", () => {
    // 14:00 New York in September is 18:00Z (EDT, -4).
    expect(
      wallTimeToUtc("2026-09-18", "14:00", "America/New_York").toISOString()
    ).toBe("2026-09-18T18:00:00.000Z");
  });

  it("handles a half-hour offset", () => {
    // 14:00 Kolkata is 08:30Z.
    expect(
      wallTimeToUtc("2026-09-18", "14:00", "Asia/Kolkata").toISOString()
    ).toBe("2026-09-18T08:30:00.000Z");
  });
});

describe("salonDayRange", () => {
  it("bounds a BST day at London midnight, not UTC midnight", () => {
    const { from, to } = salonDayRange("2026-09-18", TZ);
    expect(from).toBe("2026-09-17T23:00:00.000Z");
    expect(to).toBe("2026-09-18T23:00:00.000Z");
  });

  it("bounds a GMT day at UTC midnight, because they coincide", () => {
    const { from } = salonDayRange("2026-12-18", TZ);
    expect(from).toBe("2026-12-18T00:00:00.000Z");
  });

  it("covers the whole evening for a negative-offset zone", () => {
    // The bug this replaces: a UTC-midnight window stopped at 19:00 local
    // in New York and lost the rest of the trading day.
    const { from, to } = salonDayRange("2026-09-18", "America/New_York");
    expect(from).toBe("2026-09-18T04:00:00.000Z");
    expect(to).toBe("2026-09-19T04:00:00.000Z");

    const lateEvening = new Date("2026-09-18T23:30:00Z"); // 19:30 local
    expect(new Date(from) <= lateEvening && lateEvening < new Date(to)).toBe(true);
  });
});

describe("salonDate", () => {
  it("names the salon's day, not the browser's", () => {
    expect(salonDate(new Date("2026-09-18T22:30:00Z"), TZ)).toBe("2026-09-18");
    expect(salonDate(new Date("2026-09-18T23:30:00Z"), TZ)).toBe("2026-09-19");
  });
});

describe("quarterMarks", () => {
  it("draws a line every quarter hour across the window", () => {
    const marks = quarterMarks();
    // 08:00 to 21:00 inclusive, every 15 minutes.
    expect(marks).toHaveLength(13 * 4 + 1);
    expect(marks[0].topPct).toBe(0);
    expect(marks[marks.length - 1].topPct).toBeCloseTo(100, 5);
  });

  it("flags hours and half hours so they can be drawn differently", () => {
    const marks = quarterMarks();
    expect(marks[0].major).toBe(true);
    expect(marks[1].major).toBe(false);
    expect(marks[2].half).toBe(true);
    expect(marks[4].major).toBe(true);
  });
});
