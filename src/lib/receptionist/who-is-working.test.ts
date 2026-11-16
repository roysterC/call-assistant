import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseBusinessHours, zonedWallTimeToUtc } from "@/lib/business-hours";
import type { BlockOccurrence } from "@/lib/time-blocks";

/**
 * "Which nail tech is in on Monday?" The chat said it did not have the rota.
 * who_is_working reads the diary: who is rostered, less anyone off all day,
 * and with a time, who the diary would offer then.
 */

const TZ = "Europe/London";
// A Monday, far enough ahead that no lead time reaches it.
const MON = "2030-01-07";
const at = (hh: number, mm = 0) => zonedWallTimeToUtc(2030, 1, 7, hh, mm, TZ);

const diary = vi.hoisted(() => ({
  blocks: [] as BlockOccurrence[],
  slots: [] as Array<{ start: string; end: string; stylistName?: string }>,
  asked: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/booking/diary", () => ({ blocksBetween: async () => diary.blocks }));
vi.mock("@/lib/booking", () => ({
  getSalonConfig: async () => ({
    diary: "native",
    timeZone: TZ,
    hours: parseBusinessHours([0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: day === 0, open: "09:00", close: "18:00" }))),
    services: [
      { name: "Acrylic infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: 2700 },
      { name: "Gel polish", durationMinutes: 30, requiresPatchTest: false, priceMinor: 2000 },
    ],
    stylists: [
      { name: "Hoang", workingDays: [1, 2], services: [], bookable: true },
      { name: "Mai", workingDays: [1], services: ["Gel polish"], bookable: true },
      { name: "Lan", workingDays: [3], services: [], bookable: true },
      { name: "Front desk", workingDays: [], services: [], bookable: false },
    ],
  }),
  getBookingProvider: async () => ({
    id: "native",
    capabilities: { readAvailability: true },
    getAvailability: async (q: Record<string, unknown>) => {
      diary.asked.push(q);
      return diary.slots;
    },
  }),
  canReadAvailability: () => true,
}));

import { handleWhoIsWorking, namesText, teamInOnDay } from "./who-is-working";

beforeEach(() => {
  diary.blocks = [];
  diary.slots = [];
  diary.asked = [];
});

const holiday = (name: string): BlockOccurrence =>
  ({ blockId: "b", stylistName: name, start: at(0), end: at(23, 59), allDay: true, label: "Holiday" }) as unknown as BlockOccurrence;

describe("who is in on a day", () => {
  it("names those rostered, and not those who are not, nor the desk", async () => {
    const r = await handleWhoIsWorking("org", { date: MON });
    expect(r.inThatDay).toEqual(["Hoang", "Mai"]);
    expect(r.message).toMatch(/: Hoang and Mai\. Give names only/);
  });

  it("leaves out anyone off all day, without saying why", async () => {
    diary.blocks = [holiday("Hoang")];
    const r = await handleWhoIsWorking("org", { date: MON });
    expect(r.inThatDay).toEqual(["Mai"]);
    expect(r.message).not.toMatch(/holiday/i);
  });

  it("names only those who do the service", async () => {
    const r = await handleWhoIsWorking("org", { date: MON, service: "acrylic infill" });
    expect(r.inThatDay).toEqual(["Hoang"]);
  });

  it("says when the salon is closed", async () => {
    const r = await handleWhoIsWorking("org", { date: "2030-01-06" });
    expect(r).toMatchObject({ closed: true });
    expect(r.message).toMatch(/closed/);
  });

  it("asks which day when there is none", async () => {
    expect((await handleWhoIsWorking("org", {})).success).toBe(false);
  });
});

describe("who could do them at a time", () => {
  it("names who the diary would offer then, at the quoted length", async () => {
    diary.slots = [
      { start: at(11).toISOString(), end: at(13).toISOString(), stylistName: "Hoang" },
      { start: at(13).toISOString(), end: at(15).toISOString(), stylistName: "Hoang" },
    ];
    const r = await handleWhoIsWorking("org", { date: MON, time: "11", service: "acrylic infill", minutes: "120" });
    expect(r.freeThen).toEqual(["Hoang"]);
    expect(r.message).toMatch(/Free for acrylic infill at 11am .*: Hoang\./);
    expect(diary.asked[0]).toMatchObject({ durationMinutes: 120, serviceName: "Acrylic infill" });
  });

  it("says nobody is free then, and to look for other times", async () => {
    const r = await handleWhoIsWorking("org", { date: MON, time: "11", service: "acrylic infill" });
    expect(r.freeThen).toEqual([]);
    expect(r.message).toMatch(/Nobody is free .* check_availability/);
  });

  it("without a service, names who is in and asks for it", async () => {
    const r = await handleWhoIsWorking("org", { date: MON, time: "11" });
    expect(r.inThatDay).toEqual(["Hoang", "Mai"]);
    expect(r.message).toMatch(/depends on the service/);
    expect(diary.asked).toEqual([]);
  });
});

describe("the pieces", () => {
  it("counts someone blocked from opening to closing as not in", () => {
    const blocks = [
      { blockId: "b", stylistName: "Hoang", start: at(9), end: at(18), allDay: false } as unknown as BlockOccurrence,
    ];
    const team = [
      { name: "Hoang", workingDays: [1], services: [] },
      { name: "Mai", workingDays: [1], services: [] },
    ];
    expect(teamInOnDay({ stylists: team, weekday: 1, window: { start: at(9), end: at(18) }, blocks })).toEqual(["Mai"]);
  });

  it("joins names as people write them", () => {
    expect(namesText(["Hoang"])).toBe("Hoang");
    expect(namesText(["Hoang", "Mai", "Lan"])).toBe("Hoang, Mai and Lan");
  });
});
