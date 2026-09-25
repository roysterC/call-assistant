import { describe, expect, it } from "vitest";
import { zonedParts, zonedWallTimeToUtc } from "@/lib/business-hours";
import {
  blockApplies,
  blockToForm,
  expandBlocks,
  parseTimeBlockForm,
  type TimeBlockRecord,
} from "./time-blocks";

const TZ = "Europe/London";

const at = (date: string, hh: number, mm = 0) => {
  const [y, m, d] = date.split("-").map(Number);
  return zonedWallTimeToUtc(y, m, d, hh, mm, TZ);
};

const local = (d: Date) => {
  const p = zonedParts(d, TZ);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

function block(overrides: Partial<TimeBlockRecord>): TimeBlockRecord {
  return {
    id: "b1",
    stylistName: "Jo",
    label: "Lunch",
    allDay: false,
    repeat: "none",
    startsAt: null,
    endsAt: null,
    weekdays: [],
    startTime: null,
    endTime: null,
    fromDate: null,
    untilDate: null,
    skipDates: [],
    ...overrides,
  };
}

function weekly(overrides: Partial<TimeBlockRecord> = {}) {
  return block({
    repeat: "weekly",
    weekdays: [2, 3, 4, 5, 6], // Tue–Sat
    startTime: "13:00",
    endTime: "14:00",
    fromDate: "2026-10-01",
    ...overrides,
  });
}

describe("expandBlocks, weekly", () => {
  it("falls on the chosen days only", () => {
    // Mon 19 Oct to Mon 26 Oct 2026.
    const occ = expandBlocks([weekly()], at("2026-10-19", 0), at("2026-10-26", 0), TZ);
    expect(occ.map((o) => o.date)).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
  });

  it("stays at 1pm across the clock change", () => {
    // UK clocks go back on Sunday 25 October 2026.
    const occ = expandBlocks([weekly()], at("2026-10-23", 0), at("2026-10-28", 0), TZ);
    // Fri, Sat, then (Sun and Mon off) Tue.
    expect(occ.map((o) => o.date)).toEqual(["2026-10-23", "2026-10-24", "2026-10-27"]);
    expect(occ.map((o) => local(o.start))).toEqual(["13:00", "13:00", "13:00"]);
    expect(occ.map((o) => local(o.end))).toEqual(["14:00", "14:00", "14:00"]);
    // Friday before is BST (UTC+1), Tuesday after is GMT.
    expect(occ[0].start.toISOString()).toBe("2026-10-23T12:00:00.000Z");
    expect(occ[2].start.toISOString()).toBe("2026-10-27T13:00:00.000Z");
  });

  it("leaves out a skipped week", () => {
    const occ = expandBlocks(
      [weekly({ skipDates: ["2026-10-21"] })],
      at("2026-10-19", 0),
      at("2026-10-26", 0),
      TZ
    );
    expect(occ.map((o) => o.date)).not.toContain("2026-10-21");
    expect(occ).toHaveLength(4);
  });

  it("starts on its from date and stops after its until date", () => {
    const occ = expandBlocks(
      [weekly({ fromDate: "2026-10-21", untilDate: "2026-10-23" })],
      at("2026-10-19", 0),
      at("2026-10-26", 0),
      TZ
    );
    expect(occ.map((o) => o.date)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
  });

  it("blocks the whole day for an all-day weekly block", () => {
    const occ = expandBlocks(
      [weekly({ weekdays: [3], startTime: "00:00", endTime: "24:00", allDay: true })],
      at("2026-10-19", 0),
      at("2026-10-26", 0),
      TZ
    );
    expect(occ).toHaveLength(1);
    expect(occ[0].start.getTime()).toBe(at("2026-10-21", 0).getTime());
    expect(occ[0].end.getTime()).toBe(at("2026-10-22", 0).getTime());
  });

  it("runs a block that ends before it starts into the next morning", () => {
    const occ = expandBlocks(
      [weekly({ weekdays: [2], startTime: "22:00", endTime: "02:00" })],
      // Wednesday 00:00 to 06:00: only the tail of Tuesday night's block.
      at("2026-10-21", 0),
      at("2026-10-21", 6),
      TZ
    );
    expect(occ).toHaveLength(1);
    expect(occ[0].date).toBe("2026-10-20");
    expect(occ[0].end.getTime()).toBe(at("2026-10-21", 2).getTime());
  });

  it("returns nothing outside the window", () => {
    const occ = expandBlocks([weekly()], at("2026-10-20", 15), at("2026-10-20", 18), TZ);
    expect(occ).toEqual([]);
  });
});

describe("expandBlocks, one-off", () => {
  const holiday = block({
    label: "Holiday",
    allDay: true,
    startsAt: at("2026-10-12", 0),
    endsAt: at("2026-10-20", 0),
  });

  it("covers every day it spans", () => {
    const occ = expandBlocks([holiday], at("2026-10-15", 9), at("2026-10-15", 18), TZ);
    expect(occ).toHaveLength(1);
    expect(occ[0].date).toBe("2026-10-12");
  });

  it("does not reach past its end", () => {
    expect(expandBlocks([holiday], at("2026-10-20", 9), at("2026-10-20", 18), TZ)).toEqual([]);
  });
});

describe("blockApplies", () => {
  it("keeps out the stylist it names, whatever the case", () => {
    expect(blockApplies({ stylistName: "Jo" }, "jo")).toBe(true);
    expect(blockApplies({ stylistName: "Jo" }, "Marcus")).toBe(false);
  });

  it("keeps out everyone when it names nobody", () => {
    expect(blockApplies({ stylistName: null }, "Marcus")).toBe(true);
  });
});

describe("parseTimeBlockForm", () => {
  const base = {
    stylistName: "Jo",
    label: "Lunch",
    allDay: false,
    repeat: "none",
    startDate: "2026-10-20",
    endDate: "2026-10-20",
    startTime: "13:00",
    endTime: "14:00",
    weekdays: [],
    untilDate: null,
  };

  it("turns a one-off into the instants it runs between", () => {
    const r = parseTimeBlockForm(base, TZ);
    expect(r.ok && r.data.startsAt?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(r.ok && r.data.endsAt?.toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });

  it("runs an all-day range to the midnight after its last day", () => {
    const r = parseTimeBlockForm(
      { ...base, label: "Holiday", allDay: true, startDate: "2026-10-12", endDate: "2026-10-19" },
      TZ
    );
    expect(r.ok && r.data.startsAt?.getTime()).toBe(at("2026-10-12", 0).getTime());
    expect(r.ok && r.data.endsAt?.getTime()).toBe(at("2026-10-20", 0).getTime());
  });

  it("keeps a weekly block as a rule", () => {
    const r = parseTimeBlockForm(
      { ...base, repeat: "weekly", weekdays: [6, 2, 2, 3], untilDate: "2026-12-31" },
      TZ
    );
    expect(r).toMatchObject({
      ok: true,
      data: {
        repeat: "weekly",
        weekdays: [2, 3, 6],
        startTime: "13:00",
        endTime: "14:00",
        fromDate: "2026-10-20",
        untilDate: "2026-12-31",
        startsAt: null,
      },
    });
  });

  it("reads a blank stylist as everyone", () => {
    const r = parseTimeBlockForm({ ...base, stylistName: "" }, TZ);
    expect(r.ok && r.data.stylistName).toBeNull();
  });

  it.each([
    [{ label: " " }, /label/],
    [{ startTime: "1pm" }, /times/],
    [{ endTime: "12:00" }, /ends before/],
    [{ endDate: "2026-10-19" }, /before the start/],
    [{ repeat: "weekly", weekdays: [] }, /at least one day/],
    [{ repeat: "weekly", weekdays: [2], endTime: "13:00" }, /same time/],
    [{ allDay: true, endDate: "2028-01-01" }, /a year/],
  ])("refuses %o", (change, message) => {
    const r = parseTimeBlockForm({ ...base, ...change }, TZ);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(message);
  });
});

describe("blockToForm", () => {
  it("round-trips a one-off all-day range", () => {
    const parsed = parseTimeBlockForm(
      {
        stylistName: "Jo",
        label: "Holiday",
        allDay: true,
        repeat: "none",
        startDate: "2026-10-12",
        endDate: "2026-10-19",
        startTime: "",
        endTime: "",
        weekdays: [],
        untilDate: null,
      },
      TZ
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const form = blockToForm({ id: "x", ...parsed.data }, TZ);
    expect(form).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-19", allDay: true });
  });

  it("round-trips a timed one-off", () => {
    const parsed = parseTimeBlockForm(
      {
        stylistName: null,
        label: "Training",
        allDay: false,
        repeat: "none",
        startDate: "2026-10-27",
        endDate: "2026-10-27",
        startTime: "09:30",
        endTime: "12:00",
        weekdays: [],
        untilDate: null,
      },
      TZ
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(blockToForm({ id: "x", ...parsed.data }, TZ)).toMatchObject({
      startDate: "2026-10-27",
      startTime: "09:30",
      endTime: "12:00",
      stylistName: null,
    });
  });
});
