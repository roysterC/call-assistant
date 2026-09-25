import { describe, expect, it } from "vitest";
import { parseBusinessHours, zonedWallTimeToUtc } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";
import { readAvailability, type DiaryConfig, type LoadBusy } from "./shared";

const TZ = "Europe/London";
// Far enough ahead that no lead-time rule reaches it. A Tuesday.
const DAY = "2030-01-08";

const HOURS = parseBusinessHours(
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    closed: false,
    open: "09:00",
    close: "18:00",
  }))
);

const COLOUR: SalonService = {
  name: "Full head colour",
  durationMinutes: 120,
  requiresPatchTest: true,
  bufferMinutes: 0,
  priceMinor: 9500,
};
const CUT: SalonService = {
  name: "Cut and finish",
  durationMinutes: 45,
  requiresPatchTest: false,
  bufferMinutes: 0,
  priceMinor: 4500,
};

function person(name: string, extra: Partial<Stylist> = {}): Stylist {
  return { name, workingDays: [], services: [], ...extra };
}

function cfg(stylists: Stylist[]): DiaryConfig {
  return { timeZone: TZ, hours: HOURS, services: [COLOUR, CUT], stylists };
}

const at = (hh: number, mm = 0) => zonedWallTimeToUtc(2030, 1, 8, hh, mm, TZ);

/** Nobody busy; records who was asked about. */
function freeAll(asked: string[] = []): LoadBusy {
  return async (pool) => {
    asked.push(...pool.map((s) => s.name));
    return pool.map((stylist) => ({ stylist, busy: [] }));
  };
}

describe("readAvailability", () => {
  it("times two services as one appointment of both lengths", async () => {
    const slots = await readAvailability(
      cfg([person("Jo", { bookable: true })]),
      {
        organizationId: "org",
        date: DAY,
        serviceName: "Full head colour + Cut and finish",
      },
      freeAll()
    );
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(new Date(s.end).getTime() - new Date(s.start).getTime()).toBe(
        165 * 60_000
      );
    }
    // The last start that still finishes by six.
    expect(slots.at(-1)?.start).toBe(at(15, 15).toISOString());
  });

  it("offers nothing that overlaps a booking", async () => {
    const loadBusy: LoadBusy = async (pool) =>
      pool.map((stylist) => ({
        stylist,
        busy: [{ start: at(10), end: at(12) }],
      }));
    const slots = await readAvailability(
      cfg([person("Jo", { bookable: true })]),
      { organizationId: "org", date: DAY, serviceName: "Cut and finish" },
      loadBusy
    );
    const starts = slots.map((s) => new Date(s.start).getTime());
    expect(starts).not.toContain(at(10).getTime());
    expect(starts).not.toContain(at(11, 30).getTime());
    // 9:15 finishes at 10:00, exactly as the booking starts.
    expect(starts).toContain(at(9, 15).getTime());
    expect(starts).toContain(at(12).getTime());
  });

  it("books anyone on the salon's own diary, with or without a calendar", async () => {
    const asked: string[] = [];
    await readAvailability(
      cfg([person("Jo", { bookable: true }), person("Marcus", { bookable: true })]),
      { organizationId: "org", date: DAY, serviceName: "Cut and finish" },
      freeAll(asked)
    );
    expect(asked).toEqual(["Jo", "Marcus"]);
  });

  it("on Google, only asks about stylists with a calendar", async () => {
    const asked: string[] = [];
    await readAvailability(
      cfg([person("Jo", { googleCalendarId: "jo@x" }), person("Marcus")]),
      { organizationId: "org", date: DAY, serviceName: "Cut and finish" },
      freeAll(asked)
    );
    expect(asked).toEqual(["Jo"]);
  });

  it("narrows to the stylist asked for", async () => {
    const asked: string[] = [];
    const slots = await readAvailability(
      cfg([person("Jo", { bookable: true }), person("Marcus", { bookable: true })]),
      {
        organizationId: "org",
        date: DAY,
        serviceName: "Cut and finish",
        stylistName: "marcus",
      },
      freeAll(asked)
    );
    expect(asked).toEqual(["Marcus"]);
    expect(new Set(slots.map((s) => s.stylistName))).toEqual(new Set(["Marcus"]));
  });

  it("offers nothing in a block for that stylist, or one for everyone", async () => {
    const slots = await readAvailability(
      cfg([person("Jo", { bookable: true }), person("Marcus", { bookable: true })]),
      { organizationId: "org", date: DAY, serviceName: "Cut and finish" },
      freeAll(),
      async () => [
        { blockId: "l", stylistName: "Jo", label: "Lunch", allDay: false, repeat: "weekly", date: DAY, start: at(13), end: at(14) },
        { blockId: "c", stylistName: null, label: "Staff meeting", allDay: false, repeat: "none", date: DAY, start: at(9), end: at(10) },
      ]
    );
    const times = (who: string) =>
      slots.filter((s) => s.stylistName === who).map((s) => new Date(s.start).getTime());
    // Jo's lunch: nothing that would run into 13:00-14:00.
    expect(times("Jo")).not.toContain(at(12, 30).getTime());
    expect(times("Jo")).not.toContain(at(13, 30).getTime());
    expect(times("Jo")).toContain(at(12, 15).getTime());
    expect(times("Jo")).toContain(at(14).getTime());
    // Marcus has no lunch block.
    expect(times("Marcus")).toContain(at(13).getTime());
    // Nobody before the meeting ends.
    expect(Math.min(...times("Jo"), ...times("Marcus"))).toBe(at(10).getTime());
  });

  it("returns nothing for a service that is not on the list", async () => {
    const asked: string[] = [];
    const slots = await readAvailability(
      cfg([person("Jo", { bookable: true })]),
      { organizationId: "org", date: DAY, serviceName: "Perm" },
      freeAll(asked)
    );
    expect(slots).toEqual([]);
    expect(asked).toEqual([]);
  });
});
