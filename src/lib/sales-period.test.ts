import { describe, expect, it } from "vitest";
import {
  addDays,
  describePeriod,
  resolvePeriod,
  shiftPeriod,
  startOfWeek,
} from "./sales-period";
import { formatMoney, formatMoneyShort, minorToInput, parseMoney, sumMinor } from "./money";

const TZ = "Europe/London";

describe("startOfWeek", () => {
  it("goes back to Monday", () => {
    // 2026-09-20 is a Sunday.
    expect(startOfWeek("2026-09-20")).toBe("2026-09-14");
  });

  it("leaves a Monday alone", () => {
    expect(startOfWeek("2026-09-14")).toBe("2026-09-14");
  });

  it("crosses a month boundary backwards", () => {
    // 2026-09-02 is a Wednesday; its Monday is in August.
    expect(startOfWeek("2026-09-02")).toBe("2026-08-31");
  });
});

describe("addDays", () => {
  it("rolls over a month end", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("resolvePeriod", () => {
  it("bounds a day at salon midnight, not UTC midnight", () => {
    const p = resolvePeriod("day", "2026-09-20", TZ);
    // BST: London midnight on the 20th is 23:00Z on the 19th.
    expect(p.from).toBe("2026-09-19T23:00:00.000Z");
    expect(p.to).toBe("2026-09-20T23:00:00.000Z");
  });

  it("bounds a month at salon midnight on the first", () => {
    const p = resolvePeriod("month", "2026-09-20", TZ);
    expect(p.firstDate).toBe("2026-09-01");
    expect(p.lastDate).toBe("2026-09-30");
    expect(p.from).toBe("2026-08-31T23:00:00.000Z");
    expect(p.to).toBe("2026-09-30T23:00:00.000Z");
  });

  it("spans a clock change without losing an hour of trading", () => {
    // October 2026: BST ends on the 25th, so the month starts in BST and
    // finishes in GMT. Both ends must still be local midnight.
    const p = resolvePeriod("month", "2026-10-15", TZ);
    expect(p.from).toBe("2026-09-30T23:00:00.000Z"); // opens in BST
    // Closes at local midnight on 1 Nov, by then GMT — so the same wall time
    // is an hour later as an instant than it was at the start of the month.
    expect(p.to).toBe("2026-11-01T00:00:00.000Z");
  });

  it("runs a week Monday to Monday", () => {
    const p = resolvePeriod("week", "2026-09-20", TZ);
    expect(p.firstDate).toBe("2026-09-14");
    expect(p.lastDate).toBe("2026-09-20");
  });

  it("bounds a year", () => {
    const p = resolvePeriod("year", "2026-09-20", TZ);
    expect(p.firstDate).toBe("2026-01-01");
    expect(p.lastDate).toBe("2026-12-31");
    // January is GMT at both ends of the boundary.
    expect(p.from).toBe("2026-01-01T00:00:00.000Z");
  });

  it("puts the last evening of a month inside that month", () => {
    const p = resolvePeriod("month", "2026-09-01", TZ);
    // 30 Sep, 18:30 London = 17:30Z. Must fall inside September.
    const lastEvening = new Date("2026-09-30T17:30:00Z");
    expect(new Date(p.from) <= lastEvening && lastEvening < new Date(p.to)).toBe(true);
  });
});

describe("shiftPeriod", () => {
  it("steps a day", () => {
    expect(shiftPeriod("day", "2026-09-20", 1)).toBe("2026-09-21");
    expect(shiftPeriod("day", "2026-09-01", -1)).toBe("2026-08-31");
  });

  it("steps a week", () => {
    expect(shiftPeriod("week", "2026-09-20", -1)).toBe("2026-09-13");
  });

  it("clamps the day when stepping into a shorter month", () => {
    // Back from 31 March must not overflow into March again.
    expect(shiftPeriod("month", "2026-03-31", -1)).toBe("2026-02-28");
  });

  it("steps a month across a year boundary", () => {
    expect(shiftPeriod("month", "2026-01-15", -1)).toBe("2025-12-15");
    expect(shiftPeriod("month", "2026-12-15", 1)).toBe("2027-01-15");
  });

  it("clamps a leap day when stepping a year", () => {
    expect(shiftPeriod("year", "2028-02-29", 1)).toBe("2029-02-28");
  });
});

describe("describePeriod", () => {
  it("names each window the way someone would say it", () => {
    expect(describePeriod(resolvePeriod("month", "2026-09-20", TZ))).toBe(
      "September 2026"
    );
    expect(describePeriod(resolvePeriod("year", "2026-09-20", TZ))).toBe("2026");
    expect(describePeriod(resolvePeriod("day", "2026-09-20", TZ))).toContain(
      "Sunday"
    );
    // en-GB abbreviates September as "Sept", unlike every other month.
    expect(describePeriod(resolvePeriod("week", "2026-09-20", TZ))).toBe(
      "14 Sept – 20 Sept 2026"
    );
  });
});

describe("money", () => {
  it("formats pence as pounds", () => {
    expect(formatMoney(4500)).toBe("£45.00");
    expect(formatMoney(4550)).toBe("£45.50");
    expect(formatMoney(0)).toBe("£0.00");
  });

  it("shows an em dash rather than inventing a zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });

  it("drops the pence in the short form only when there are none", () => {
    expect(formatMoneyShort(4500)).toBe("£45");
    expect(formatMoneyShort(4550)).toBe("£45.50");
  });

  it("parses what people actually type", () => {
    expect(parseMoney("45")).toBe(4500);
    expect(parseMoney("45.5")).toBe(4550);
    expect(parseMoney("45.50")).toBe(4550);
    expect(parseMoney("£45.50")).toBe(4550);
    expect(parseMoney(" 1,250 ")).toBe(125000);
    expect(parseMoney(45.5)).toBe(4550);
  });

  it("rounds rather than truncating, so a month of entries does not drift", () => {
    expect(parseMoney("45.555")).toBe(4556);
  });

  it("returns null for what it cannot read, rather than zero", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("£")).toBeNull();
    expect(parseMoney(".")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });

  it("round-trips through the editable form", () => {
    expect(parseMoney(minorToInput(4550))).toBe(4550);
    expect(minorToInput(null)).toBe("");
  });

  it("sums past the nulls a half-finished day is full of", () => {
    expect(sumMinor([4500, null, 1200, undefined])).toBe(5700);
    expect(sumMinor([])).toBe(0);
  });
});
