import { describe, expect, it } from "vitest";
import { whoIsFree, type BusyStretch } from "./free-now";
import type { Stylist } from "@/lib/salon-config";

// Tuesday 10 November 2026: London is on GMT, so the times below are the salon's.
const at = (hhmm: string) => new Date(`2026-11-10T${hhmm}:00Z`);
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: day === 0, open: "09:00", close: "18:00" }));
const team: Stylist[] = [
  { name: "Lan", workingDays: [], services: [], bookable: true },
  { name: "Mai", workingDays: [2], services: [], bookable: true },
  { name: "Hoa", workingDays: [3], services: [], bookable: true },
  { name: "Desk", workingDays: [], services: [], bookable: false },
];
const busy = (entries: Record<string, BusyStretch[]>) =>
  new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
const diary = busy({
  Lan: [
    { start: at("09:30"), end: at("10:30"), what: "Jane, BIAB infill" },
    { start: at("10:30"), end: at("11:00"), what: "Sue, Gel removal" },
    { start: at("13:00"), end: at("14:00"), what: "Kim, Gel manicure" },
  ],
  Mai: [{ start: at("10:20"), end: at("11:00"), what: "Lucy, Acrylic infill" }],
});
const run = (now: Date, extra: Partial<Parameters<typeof whoIsFree>[0]> = {}) =>
  whoIsFree({ now, timeZone: "Europe/London", hours, stylists: team, busy: diary, ...extra });

describe("who is free now", () => {
  it("says who is free this minute, who is busy until when, and who is not in", () => {
    const r = run(at("10:02"));
    expect(r.people.map((p) => p.name)).toEqual(["Mai", "Lan", "Hoa"]);
    const [mai, lan, hoa] = r.people;
    expect(mai).toMatchObject({ busyNow: null, nextFree: { start: at("10:05"), end: at("10:20") } });
    // Two clients back to back are one busy stretch.
    expect(lan).toMatchObject({
      busyNow: { until: at("11:00"), what: "Jane, BIAB infill" },
      nextFree: { start: at("11:00"), end: at("13:00") },
    });
    expect(hoa).toMatchObject({ working: false, nextFree: null });
  });

  it("leaves out anyone who cannot be booked", () => {
    expect(run(at("10:02")).people.some((p) => p.name === "Desk")).toBe(false);
  });

  it("with a service, says when each could start it", () => {
    const r = run(at("10:02"), { service: { name: "Gel manicure", durationMinutes: 45, requiresPatchTest: false, priceMinor: null } });
    expect(r.people.map((p) => [p.name, p.canStartAt?.toISOString() ?? null])).toEqual([
      ["Lan", at("11:00").toISOString()],
      ["Mai", at("11:00").toISOString()],
      ["Hoa", null],
    ]);
  });

  it("counts a gap under fifteen minutes as no gap", () => {
    const r = run(at("17:50"));
    expect(r.closedNow).toBe(false);
    expect(r.people.find((p) => p.name === "Lan")?.nextFree).toBeNull();
  });

  it("starts from opening time before the salon opens", () => {
    expect(run(at("07:40")).people.find((p) => p.name === "Lan")?.nextFree?.start).toEqual(at("09:00"));
  });

  it("knows when the salon is shut", () => {
    expect(run(at("18:00"))).toMatchObject({ closedToday: false, closedNow: true });
    expect(run(new Date("2026-11-08T11:00:00Z"))).toMatchObject({ closedToday: true, people: [] });
  });

  it("counts someone blocked all day as not in", () => {
    const r = run(at("10:02"), {
      busy: busy({ Mai: [{ start: at("00:00"), end: new Date("2026-11-11T00:00:00Z"), what: "Holiday", allDay: true }] }),
    });
    expect(r.people.find((p) => p.name === "Mai")?.working).toBe(false);
  });
});
