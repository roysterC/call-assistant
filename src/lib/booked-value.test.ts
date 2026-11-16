import { describe, expect, it } from "vitest";
import { channelOf, summariseBooked, type BookedRow } from "./booked-value";
import { bookedByMessageNote } from "./booked-by";
import type { BusinessHours } from "./business-hours";

const TZ = "Europe/London";
// Open 9 to 5 every day.
const HOURS: BusinessHours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, closed: false, open: "09:00", close: "17:00" }));
const PRICES: Record<string, number> = { "gel manicure": 3500, "biab infill": 3800 };
const priceOf = (s: string) => PRICES[s.toLowerCase()] ?? null;

const row = (at: string, serviceText: string, extra: Partial<BookedRow> = {}): BookedRow => ({
  createdAt: new Date(at),
  serviceText,
  amountMinor: null,
  notes: null,
  ...extra,
});

describe("channelOf", () => {
  it("reads the chat from a message booking's notes, else it was a call", () => {
    expect(channelOf(null)).toBe("phone");
    expect(channelOf("Wants nude pink.")).toBe("phone");
    expect(channelOf(`Wants nude pink. ${bookedByMessageNote("whatsapp")}`)).toBe("whatsapp");
    expect(channelOf(bookedByMessageNote("instagram"))).toBe("instagram");
    expect(channelOf(bookedByMessageNote("facebook"))).toBe("facebook");
    expect(channelOf(bookedByMessageNote("website"))).toBe("website");
  });
});

describe("summariseBooked", () => {
  const base = { priceOf, hours: HOURS, timeZone: TZ };

  it("adds the price taken, else the list price, and counts what has neither", () => {
    const r = summariseBooked({
      ...base,
      rows: [
        row("2026-11-10T10:00:00Z", "Gel manicure"),
        row("2026-11-10T11:00:00Z", "Gel manicure", { amountMinor: 4000 }),
        row("2026-11-10T12:00:00Z", "Something new"),
      ],
    });
    expect(r.totalMinor).toBe(7500);
    expect(r.bookings).toBe(3);
    expect(r.unpriced).toBe(1);
  });

  it("splits the value by where it was booked, calls first", () => {
    const r = summariseBooked({
      ...base,
      rows: [
        row("2026-11-10T10:00:00Z", "Gel manicure", { notes: bookedByMessageNote("instagram") }),
        row("2026-11-10T11:00:00Z", "BIAB infill"),
        row("2026-11-10T12:00:00Z", "Gel manicure"),
      ],
    });
    expect(r.channels).toEqual([
      { channel: "phone", valueMinor: 7300, bookings: 2 },
      { channel: "instagram", valueMinor: 3500, bookings: 1 },
    ]);
  });

  it("knows what was booked while the salon was shut, in its own time zone", () => {
    const r = summariseBooked({
      ...base,
      rows: [
        // 10:00 in London: open.
        row("2026-11-10T10:00:00Z", "Gel manicure"),
        // 22:30 in London: closed.
        row("2026-11-10T22:30:00Z", "BIAB infill"),
      ],
    });
    expect(r.afterHoursMinor).toBe(3800);
    expect(summariseBooked({ ...base, hours: [], rows: [] }).afterHoursMinor).toBeNull();
  });

  it("picks the most booked service that has a price, for the comparison", () => {
    const r = summariseBooked({
      ...base,
      rows: [
        row("2026-11-10T10:00:00Z", "Mystery set"),
        row("2026-11-10T10:00:00Z", "Mystery set"),
        row("2026-11-10T10:00:00Z", "Mystery set"),
        row("2026-11-10T10:00:00Z", "BIAB infill"),
        row("2026-11-10T10:00:00Z", "Gel manicure"),
        row("2026-11-10T10:00:00Z", "gel manicure"),
      ],
    });
    expect(r.favourite).toEqual({ service: "Gel manicure", priceMinor: 3500 });
    expect(summariseBooked({ ...base, rows: [] }).favourite).toBeNull();
  });
});
