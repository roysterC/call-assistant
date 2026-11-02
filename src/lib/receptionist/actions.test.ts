import { describe, expect, it } from "vitest";

// --- Phone bookings only go where the diary would offer --------------------

import { slotProblem as phoneSlotProblem } from "@/lib/booking/rules";
import type { SalonConfig } from "@/lib/booking";
import type { BookingProvider } from "@/lib/booking/types";

describe("phoneSlotProblem", () => {
  const cut = { name: "Cut and finish", durationMinutes: 45, bufferMinutes: 0, requiresPatchTest: false, priceMinor: 4500 };
  const marcus = { name: "Marcus", workingDays: [2, 3, 4, 5], services: [] };
  const cfg = {
    timeZone: "Europe/London",
    hours: [
      { day: 0, closed: true, open: "", close: "" },
      { day: 3, closed: false, open: "09:00", close: "18:00" },
      { day: 6, closed: false, open: "08:30", close: "17:00" },
    ],
    services: [cut],
    stylists: [marcus],
  } as unknown as SalonConfig;
  // Wednesday 30 September 2026, London (UTC+1).
  const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00+01:00`);
  const offering = (...times: string[]) =>
    ({
      id: "native",
      capabilities: { readAvailability: true },
      getAvailability: async () => times.map((t) => ({ start: at(t).toISOString(), end: "", stylistName: "Marcus" })),
    }) as unknown as BookingProvider;

  it("refuses 3am, which a named stylist and a straight booking once let through", async () => {
    const why = await phoneSlotProblem(offering("03:00"), "org", cfg, at("03:00"), cut, marcus, { offeredOnly: true });
    expect(why).toMatch(/outside opening hours/);
  });

  it("refuses a service that would run past closing", async () => {
    const why = await phoneSlotProblem(offering("17:30"), "org", cfg, at("17:30"), cut, marcus, { offeredOnly: true });
    expect(why).toMatch(/open 09:00 to 18:00/);
  });

  it("refuses a closed day, and a day the stylist is not in", async () => {
    const sunday = new Date("2026-10-04T10:00:00+01:00");
    expect(await phoneSlotProblem(offering(), "org", cfg, sunday, cut, marcus, { offeredOnly: false })).toMatch(/closed on Sundays/);
    const saturday = new Date("2026-10-03T10:00:00+01:00");
    expect(await phoneSlotProblem(offering(), "org", cfg, saturday, cut, marcus, { offeredOnly: false })).toMatch(
      /Marcus does not work on Saturdays/
    );
  });

  it("refuses a new booking at a time the diary would not offer", async () => {
    const why = await phoneSlotProblem(offering("10:00"), "org", cfg, at("11:00"), cut, marcus, { offeredOnly: true });
    expect(why).toMatch(/check_availability/);
  });

  it("allows a time the diary offers, inside hours", async () => {
    expect(await phoneSlotProblem(offering("10:00"), "org", cfg, at("10:00"), cut, marcus, { offeredOnly: true })).toBeNull();
    // A move is checked on hours alone: its own current slot would look busy.
    expect(await phoneSlotProblem(offering(), "org", cfg, at("11:00"), cut, marcus, { offeredOnly: false })).toBeNull();
  });
});
