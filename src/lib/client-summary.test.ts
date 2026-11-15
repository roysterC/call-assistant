import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/booking", () => ({ getSalonConfig: async () => ({}) }));

import { summariseVisits, type VisitRow } from "./client-summary";
import type { SalonService } from "@/lib/salon-config";

const now = new Date("2026-11-15T12:00:00Z");
const day = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, "0")}:00:00Z`);
const v = (d: string, serviceText: string, stylistName: string, status = "completed", amountMinor: number | null = 3800): VisitRow => ({
  startsAt: day(d),
  serviceText,
  stylistName,
  status,
  amountMinor,
});
const services = [
  { name: "BIAB infill", rebookWeeks: 3 },
  { name: "Pedicure" },
] as unknown as SalonService[];

describe("a client's visits, summed up", () => {
  it("counts visits and spend, and finds what they usually have and with whom", () => {
    const s = summariseVisits(
      [
        v("2026-10-24", "BIAB infill", "Lan"),
        v("2026-10-03", "BIAB infill", "Lan"),
        v("2026-09-12", "BIAB infill", "Mai"),
        v("2026-08-20", "Pedicure", "Mai", "completed", 3500),
        v("2026-08-01", "BIAB infill", "Lan", "no_show", null),
      ],
      now,
      services,
      "Europe/London"
    );
    expect(s).toMatchObject({
      visits: 4,
      spentMinor: 3800 * 3 + 3500,
      noShows: 1,
      usual: { service: "BIAB infill", stylist: "Lan" },
      gapDays: 21,
      next: null,
      due: { on: "2026-11-14", service: "BIAB infill" },
    });
    expect(s.lastVisit?.toISOString()).toBe(day("2026-10-24").toISOString());
  });

  it("is not due back with something booked, and shows what is next", () => {
    const s = summariseVisits(
      [v("2026-10-24", "BIAB infill", "Lan"), v("2026-11-20", "BIAB infill", "Lan", "booked", null)],
      now,
      services,
      "Europe/London"
    );
    expect(s.due).toBeNull();
    expect(s.next).toMatchObject({ service: "BIAB infill", stylist: "Lan" });
    expect(s.gapDays).toBeNull();
  });

  it("has no due date for a service with no rebook time, and nothing at all for a new client", () => {
    expect(summariseVisits([v("2026-10-24", "Pedicure", "Mai")], now, services, "Europe/London").due).toBeNull();
    expect(summariseVisits([], now, services, "Europe/London")).toMatchObject({
      lastVisit: null,
      visits: 0,
      usual: null,
      next: null,
      due: null,
    });
  });
});
