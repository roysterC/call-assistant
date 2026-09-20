import { describe, expect, it } from "vitest";
import {
  computeBookableSlots,
  computeForwardSlots,
  earliestBookableStart,
  summariseSlotsForSpeech,
  type BusyBlock,
} from "./availability";
import {
  addCalendarDays,
  parseBusinessHours,
  nextOpenMorning,
  zonedWallTimeToUtc,
  zonedParts,
} from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";

const TZ = "Europe/London";

// Shogo's hours: closed Mon & Sun, 9-6 Tue/Wed/Fri, 9-8 Thu, 8:30-5 Sat.
const HOURS = parseBusinessHours([
  { day: 0, closed: true },
  { day: 1, closed: true },
  { day: 2, closed: false, open: "09:00", close: "18:00" },
  { day: 3, closed: false, open: "09:00", close: "18:00" },
  { day: 4, closed: false, open: "09:00", close: "20:00" },
  { day: 5, closed: false, open: "09:00", close: "18:00" },
  { day: 6, closed: false, open: "08:30", close: "17:00" },
]);

const CUT: SalonService = {
  name: "Cut and finish",
  durationMinutes: 45,
  requiresPatchTest: false,
  bufferMinutes: 0,
  priceMinor: 4500,
};

const BALAYAGE: SalonService = {
  name: "Balayage",
  durationMinutes: 180,
  requiresPatchTest: true,
  bufferMinutes: 0,
  priceMinor: 18000,
};

function stylist(name: string, workingDays: number[] = []): Stylist {
  return {
    name,
    googleCalendarId: `${name.toLowerCase()}@shogo.test`,
    workingDays,
    services: [],
  };
}

/** A wall-clock time on a given date, in salon time. */
function at(date: string, hh: number, mm = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  return zonedWallTimeToUtc(y, m, d, hh, mm, TZ);
}

/** Fractional hours allowed, e.g. 14.75 for 14:45. */
function busy(date: string, fromH: number, toH: number): BusyBlock {
  const split = (h: number): [number, number] => [
    Math.floor(h),
    Math.round((h - Math.floor(h)) * 60),
  ];
  const [fh, fm] = split(fromH);
  const [th, tm] = split(toH);
  return { start: at(date, fh, fm), end: at(date, th, tm) };
}

/** Local "HH:MM" for a slot, which is what a caller would actually hear. */
function localTimes(slots: { start: string }[]): string[] {
  return slots.map((s) => {
    const p = zonedParts(new Date(s.start), TZ);
    return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  });
}

describe("computeBookableSlots", () => {
  // 2026-09-15 is a Tuesday (BST). 2026-09-14 is the Monday.
  const TUE = "2026-09-15";
  const MON = "2026-09-14";
  const THU = "2026-09-17";

  it("returns nothing on a day the salon is closed", () => {
    const slots = computeBookableSlots({
      date: MON,
      timeZone: TZ,
      hours: HOURS,
      service: CUT,
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      clientType: "returning",
      now: at(MON, 6),
    });
    expect(slots).toEqual([]);
  });

  it("never offers a stylist on a day they do not work", () => {
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: CUT,
      // Marcus works Wed-Sat only.
      candidates: [{ stylist: stylist("Marcus", [3, 4, 5, 6]), busy: [] }],
      clientType: "returning",
      now: at(TUE, 6),
    });
    expect(slots).toEqual([]);
  });

  it("does not offer a slot the service cannot finish inside", () => {
    // Balayage is 3h; Tuesday closes at 18:00, so 15:00 is the last start.
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: { ...BALAYAGE, requiresPatchTest: false },
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      clientType: "returning",
      now: at(TUE, 6),
    });
    const times = localTimes(slots);
    expect(times).toContain("15:00");
    expect(times).not.toContain("15:15");
    expect(times.at(-1)).toBe("15:00");
  });

  it("never squeezes a 3h service into a 45m gap", () => {
    // Jo is busy 09:00-14:00 and 14:45-18:00, leaving exactly 45 minutes.
    const gapped: BusyBlock[] = [busy(TUE, 9, 14), busy(TUE, 14.75, 18)];
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: { ...BALAYAGE, requiresPatchTest: false },
      candidates: [{ stylist: stylist("Jo"), busy: gapped }],
      clientType: "returning",
      now: at(TUE, 6),
    });
    expect(slots).toEqual([]);
  });

  it("offers a 45m service in that same gap", () => {
    const gapped: BusyBlock[] = [busy(TUE, 9, 14), busy(TUE, 14.75, 18)];
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: CUT,
      candidates: [{ stylist: stylist("Jo"), busy: gapped }],
      clientType: "returning",
      now: at(TUE, 6),
    });
    expect(localTimes(slots)).toEqual(["14:00"]);
  });

  it("excludes busy blocks and keeps the surrounding slots", () => {
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: CUT,
      candidates: [{ stylist: stylist("Jo"), busy: [busy(TUE, 11, 12)] }],
      clientType: "returning",
      now: at(TUE, 6),
    });
    const times = localTimes(slots);
    expect(times).toContain("10:00");
    expect(times).toContain("12:00");
    // Anything starting inside 11:00-12:00, or overlapping into it.
    expect(times).not.toContain("11:00");
    expect(times).not.toContain("11:30");
    expect(times).not.toContain("10:30"); // 10:30 + 45m runs into 11:00
  });

  it("respects the minimum lead time", () => {
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: CUT,
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      clientType: "returning",
      now: at(TUE, 10), // 2h default lead -> nothing before 12:00
      minLeadMinutes: 120,
    });
    const times = localTimes(slots);
    expect(times[0]).toBe("12:00");
  });

  it("respects a buffer against other bookings without blocking close", () => {
    const withBuffer = { ...CUT, bufferMinutes: 15 };
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: withBuffer,
      candidates: [{ stylist: stylist("Jo"), busy: [busy(TUE, 11, 12)] }],
      clientType: "returning",
      now: at(TUE, 6),
    });
    const times = localTimes(slots);
    // 10:00 + 45m + 15m buffer = 11:00 exactly, which is fine (half-open).
    expect(times).toContain("10:00");
    // 10:15 + 45m + 15m = 11:15, which runs into the 11:00 booking.
    expect(times).not.toContain("10:15");
    // The buffer may run past closing; 17:15 + 45m = 18:00 service end.
    expect(times).toContain("17:15");
  });

  it("merges candidates and sorts by time then stylist", () => {
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: CUT,
      candidates: [
        { stylist: stylist("Siobhan"), busy: [] },
        { stylist: stylist("Jo"), busy: [] },
      ],
      clientType: "returning",
      now: at(TUE, 6),
    });
    expect(slots[0].stylistName).toBe("Jo");
    expect(slots[1].stylistName).toBe("Siobhan");
    expect(slots[0].start).toBe(slots[1].start);
  });

  it("skips a stylist with no calendar configured", () => {
    const noCalendar: Stylist = {
      name: "Chloe",
      workingDays: [],
      services: [],
    };
    const slots = computeBookableSlots({
      date: TUE,
      timeZone: TZ,
      hours: HOURS,
      service: CUT,
      candidates: [{ stylist: noCalendar, busy: [] }],
      clientType: "returning",
      now: at(TUE, 6),
    });
    expect(slots).toEqual([]);
  });

  describe("patch test", () => {
    it("pushes a new client's colour past 48 hours", () => {
      // Calling late Tuesday for a Thursday balayage: Thursday 09:00 is only
      // ~35h away, so nothing should be offered that day.
      const slots = computeBookableSlots({
        date: THU,
        timeZone: TZ,
        hours: HOURS,
        service: BALAYAGE,
        candidates: [{ stylist: stylist("Jo"), busy: [] }],
        clientType: "new",
        now: at(TUE, 22),
      });
      expect(slots).toEqual([]);
    });

    it("allows the same booking for a returning client", () => {
      const slots = computeBookableSlots({
        date: THU,
        timeZone: TZ,
        hours: HOURS,
        service: BALAYAGE,
        candidates: [{ stylist: stylist("Jo"), busy: [] }],
        clientType: "returning",
        now: at(TUE, 22),
      });
      expect(slots.length).toBeGreaterThan(0);
      expect(localTimes(slots)[0]).toBe("09:00");
    });

    it("treats an unknown client as new", () => {
      const slots = computeBookableSlots({
        date: THU,
        timeZone: TZ,
        hours: HOURS,
        service: BALAYAGE,
        candidates: [{ stylist: stylist("Jo"), busy: [] }],
        clientType: "unknown",
        now: at(TUE, 22),
      });
      expect(slots).toEqual([]);
    });

    it("does not delay a non-colour service", () => {
      const slots = computeBookableSlots({
        date: THU,
        timeZone: TZ,
        hours: HOURS,
        service: CUT,
        candidates: [{ stylist: stylist("Jo"), busy: [] }],
        clientType: "new",
        now: at(TUE, 22),
      });
      expect(slots.length).toBeGreaterThan(0);
    });
  });

  describe("DST", () => {
    // UK clocks go back 02:00 -> 01:00 on Sunday 2026-10-25.
    const SAT_BST = "2026-10-24"; // BST, UTC+1
    const SAT_GMT = "2026-10-31"; // GMT, UTC+0

    it("anchors opening time to local wall clock either side of the change", () => {
      for (const date of [SAT_BST, SAT_GMT]) {
        const slots = computeBookableSlots({
          date,
          timeZone: TZ,
          hours: HOURS,
          service: CUT,
          candidates: [{ stylist: stylist("Jo"), busy: [] }],
          clientType: "returning",
          now: at(date, 5),
        });
        // Saturday opens 08:30 in local time, whichever side of the switch.
        expect(localTimes(slots)[0]).toBe("08:30");
      }
    });

    it("produces different UTC instants for the same local opening time", () => {
      const bst = at(SAT_BST, 8, 30).toISOString();
      const gmt = at(SAT_GMT, 8, 30).toISOString();
      expect(bst).toContain("T07:30"); // BST = UTC+1
      expect(gmt).toContain("T08:30"); // GMT = UTC+0
    });
  });
});

describe("earliestBookableStart", () => {
  const now = new Date("2026-09-15T09:00:00Z");

  it("reports patch_test when that is the binding constraint", () => {
    const r = earliestBookableStart(BALAYAGE, "new", now);
    expect(r.reason).toBe("patch_test");
    expect(r.at.toISOString()).toBe("2026-09-17T09:00:00.000Z");
  });

  it("reports lead_time otherwise", () => {
    const r = earliestBookableStart(CUT, "new", now);
    expect(r.reason).toBe("lead_time");
    expect(r.at.toISOString()).toBe("2026-09-15T11:00:00.000Z");
  });
});

describe("summariseSlotsForSpeech", () => {
  const mk = (iso: string, stylistName: string) => ({
    start: iso,
    end: iso,
    stylistName,
  });

  it("collapses duplicate start times across stylists", () => {
    const out = summariseSlotsForSpeech(
      [mk("2026-09-15T09:00:00Z", "Jo"), mk("2026-09-15T09:00:00Z", "Siobhan")],
      3
    );
    expect(out).toHaveLength(1);
  });

  it("spreads options across the day rather than clustering", () => {
    const slots = Array.from({ length: 20 }, (_, i) =>
      mk(new Date(Date.UTC(2026, 8, 15, 9, i * 15)).toISOString(), "Jo")
    );
    const out = summariseSlotsForSpeech(slots, 3);
    expect(out).toHaveLength(3);
    expect(out[0].start).toBe(slots[0].start);
    expect(out[2].start).toBe(slots[19].start);
  });
});

describe("nextOpenMorning", () => {
  it("skips Sunday and Monday from a late Saturday call", () => {
    // Saturday 2026-09-19, 21:00 local — after close.
    const from = at("2026-09-19", 21);
    const next = nextOpenMorning(HOURS, TZ, from);
    expect(next).not.toBeNull();
    const p = zonedParts(next!, TZ);
    expect(p.weekday).toBe(2); // Tuesday
    expect(`${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`)
      .toBe("2026-09-22");
    expect(p.hour).toBe(9);
  });

  it("returns now when the salon is currently open", () => {
    const from = at("2026-09-15", 11);
    expect(nextOpenMorning(HOURS, TZ, from)?.toISOString()).toBe(
      from.toISOString()
    );
  });

  it("returns null when hours are unconfigured", () => {
    expect(nextOpenMorning([], TZ, new Date())).toBeNull();
  });
});

describe("addCalendarDays", () => {
  it("steps whole days, not 24-hour blocks", () => {
    expect(addCalendarDays("2026-09-15", 1)).toBe("2026-09-16");
    expect(addCalendarDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  // The clocks go back on 2026-10-25. Adding 24 hours to the Saturday lands
  // on the Sunday twice over; calendar arithmetic does not.
  it("crosses a DST boundary without slipping", () => {
    expect(addCalendarDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addCalendarDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addCalendarDays("2026-10-24", 3)).toBe("2026-10-27");
  });
});

describe("computeForwardSlots", () => {
  // Monday is closed, Tuesday and Wednesday are 9-6.
  const MON = "2026-09-14";
  const TUE = "2026-09-15";
  const WED = "2026-09-16";

  const base = {
    timeZone: TZ,
    hours: HOURS,
    service: CUT,
    clientType: "returning" as const,
  };

  it("walks past a closed day to find the next open one", () => {
    const slots = computeForwardSlots({
      ...base,
      fromDate: MON,
      searchDays: 3,
      maxDaysWithSlots: 1,
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      now: at(MON, 6),
    });
    expect(slots.length).toBeGreaterThan(0);
    // Everything returned is on the Tuesday, not the closed Monday.
    const days = new Set(slots.map((s) => s.start.slice(0, 10)));
    expect([...days]).toEqual(["2026-09-15"]);
  });

  it("walks past a fully booked day", () => {
    const slots = computeForwardSlots({
      ...base,
      fromDate: TUE,
      searchDays: 3,
      maxDaysWithSlots: 1,
      candidates: [
        { stylist: stylist("Jo"), busy: [busy(TUE, 8, 19)] },
      ],
      now: at(TUE, 6),
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((s) => s.start.slice(0, 10)))).toEqual(
      new Set([WED])
    );
  });

  it("stops after the day cap rather than returning a fortnight of slots", () => {
    const slots = computeForwardSlots({
      ...base,
      fromDate: TUE,
      searchDays: 14,
      maxDaysWithSlots: 2,
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      now: at(TUE, 6),
    });
    const days = new Set(slots.map((s) => s.start.slice(0, 10)));
    expect(days.size).toBe(2);
  });

  it("returns soonest first, so the head of the list is the answer", () => {
    const slots = computeForwardSlots({
      ...base,
      fromDate: TUE,
      searchDays: 5,
      maxDaysWithSlots: 3,
      candidates: [{ stylist: stylist("Jo"), busy: [busy(TUE, 8, 15)] }],
      now: at(TUE, 6),
    });
    expect(localTimes(slots.slice(0, 1))).toEqual(["15:00"]);
    const starts = slots.map((s) => s.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it("finds nothing when every day in range is shut", () => {
    const closed = parseBusinessHours([
      { day: 0, closed: true },
      { day: 1, closed: true },
      { day: 2, closed: true },
      { day: 3, closed: true },
      { day: 4, closed: true },
      { day: 5, closed: true },
      { day: 6, closed: true },
    ]);
    const slots = computeForwardSlots({
      ...base,
      hours: closed,
      fromDate: TUE,
      searchDays: 14,
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      now: at(TUE, 6),
    });
    expect(slots).toEqual([]);
  });

  // A new client's colour cannot happen inside 48 hours whichever day is
  // searched — the forward walk must not sneak past the patch-test floor.
  it("still honours the patch-test floor across days", () => {
    const slots = computeForwardSlots({
      ...base,
      service: BALAYAGE,
      clientType: "new",
      fromDate: TUE,
      searchDays: 7,
      maxDaysWithSlots: 1,
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      now: at(TUE, 9),
    });
    expect(slots.length).toBeGreaterThan(0);
    const floor = at(TUE, 9).getTime() + 48 * 60 * 60 * 1000;
    for (const s of slots) {
      expect(new Date(s.start).getTime()).toBeGreaterThanOrEqual(floor);
    }
  });

  it("treats searchDays of 1 as the single-day behaviour it replaced", () => {
    const args = {
      ...base,
      candidates: [{ stylist: stylist("Jo"), busy: [] }],
      now: at(TUE, 6),
    };
    const forward = computeForwardSlots({ ...args, fromDate: TUE, searchDays: 1 });
    const single = computeBookableSlots({ ...args, date: TUE });
    expect(forward).toEqual(single);
  });
});
