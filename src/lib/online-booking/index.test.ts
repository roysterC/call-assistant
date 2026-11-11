import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookingProvider, TimeSlot } from "@/lib/booking/types";
import { parseBusinessHours } from "@/lib/business-hours";

const handleBookAppointment = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/receptionist/booking", () => ({
  handleBookAppointment: (...args: unknown[]) => handleBookAppointment(...args),
}));

const { bookOnline, buildPublicSalon, onlineAvailability } = await import("./index");

const TZ = "Europe/London";
const NOW = new Date("2026-11-11T10:00:00Z"); // Wednesday
const HOURS = parseBusinessHours(
  [2, 3, 4, 5, 6].map((day) => ({ day, closed: false, open: "09:00", close: "17:30" }))
);

let free: TimeSlot[] = [];
const getAvailability = vi.fn(async () => free);
const provider = {
  id: "native",
  capabilities: {
    readAvailability: true,
    createBooking: true,
    perStaffAvailability: true,
    forwardSearch: true,
    availabilityIsAdvisory: false,
  },
  getAvailability,
  createBooking: vi.fn(),
} as unknown as BookingProvider;

function online(over: { takesBookings?: boolean; maxDaysAhead?: number; stylistChoice?: boolean } = {}) {
  const salon = buildPublicSalon({
    slug: "maison-hair",
    name: "Maison Hair",
    phone: "01234 567890",
    timeZone: TZ,
    hours: HOURS,
    services: [
      { name: "Cut", durationMinutes: 60, requiresPatchTest: false, priceMinor: 4500 },
      { name: "Root colour", durationMinutes: 90, requiresPatchTest: true, priceMinor: 6000 },
      { name: "Consultation", durationMinutes: 15, requiresPatchTest: false, priceMinor: null },
    ],
    stylists: [
      { name: "Jo", bookable: true, workingDays: [], services: [] },
      { name: "Sam", bookable: true, workingDays: [], services: ["Cut"] },
    ],
    hiddenServices: ["Consultation"],
    stylistChoice: over.stylistChoice ?? true,
    maxDaysAhead: over.maxDaysAhead ?? 56,
  });
  return {
    organizationId: "org1",
    salon,
    cfg: {} as never,
    provider,
    takesBookings: over.takesBookings ?? true,
  };
}

const request = {
  service: "Cut",
  start: "2026-11-12T10:00:00.000Z",
  stylist: "Sam",
  name: "Sarah Jones",
  phone: "07700 900123",
};

beforeEach(() => {
  handleBookAppointment.mockReset();
  getAvailability.mockClear();
  free = [];
});

describe("onlineAvailability", () => {
  it("asks the engine for a week in one go, and for a new client's colour as new", async () => {
    await onlineAvailability(online(), { service: "root colour", from: "2026-11-12", newClient: true }, NOW);
    expect(getAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-11-12",
        serviceName: "Root colour",
        clientType: "new",
        searchDays: 7,
        maxDaysWithSlots: 7,
      })
    );
  });

  it("ignores a stylist who does not do the service, or when clients cannot choose", async () => {
    await onlineAvailability(online(), { service: "Root colour", stylist: "Sam" }, NOW);
    expect(getAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ stylistName: undefined }));
    await onlineAvailability(online({ stylistChoice: false }), { service: "Cut", stylist: "Sam" }, NOW);
    expect(getAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ stylistName: undefined }));
    await onlineAvailability(online(), { service: "Cut", stylist: "sam" }, NOW);
    expect(getAvailability).toHaveBeenLastCalledWith(expect.objectContaining({ stylistName: "Sam" }));
  });

  it("refuses a hidden service", async () => {
    const res = await onlineAvailability(online(), { service: "Consultation" }, NOW);
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("offers the next week until the last bookable day", async () => {
    const a = await onlineAvailability(online({ maxDaysAhead: 10 }), { service: "Cut" }, NOW);
    expect(a).toMatchObject({ ok: true, from: "2026-11-11", next: "2026-11-18", lastDate: "2026-11-21" });
    const b = await onlineAvailability(online({ maxDaysAhead: 10 }), { service: "Cut", from: "2026-11-18" }, NOW);
    expect(b).toMatchObject({ ok: true, next: null });
  });
});

describe("bookOnline", () => {
  it("books through the receptionist's own path, as a website booking", async () => {
    handleBookAppointment.mockResolvedValue({
      success: true,
      bookingNumber: 1043,
      service: "Cut",
      stylist: "Sam",
      textSent: true,
    });
    const res = await bookOnline(online(), { ...request, notes: " Fringe only " }, NOW);
    expect(res).toMatchObject({ ok: true, bookingNumber: 1043, stylist: "Sam", textSent: true });
    expect(handleBookAppointment).toHaveBeenCalledWith(
      "org1",
      {
        time: "2026-11-12T10:00:00.000Z",
        service: "Cut",
        stylist: "Sam",
        customerPhone: "+447700900123",
        customerName: "Sarah Jones",
        notes: "Fringe only",
      },
      { source: "website" }
    );
  });

  it("says whether a colour client is new, so the skin-test rule is the phone's", async () => {
    handleBookAppointment.mockResolvedValue({ success: true, bookingNumber: 1, service: "Root colour", stylist: "Jo" });
    await bookOnline(online(), { ...request, service: "Root colour", stylist: "Jo", newClient: true }, NOW);
    expect(handleBookAppointment.mock.calls[0][1]).toMatchObject({ clientType: "new" });
    await bookOnline(online(), { ...request, service: "Root colour", stylist: "Jo" }, NOW);
    expect(handleBookAppointment.mock.calls[1][1]).toMatchObject({ clientType: "returning" });
  });

  it("checks name, number, service and time before the diary is touched", async () => {
    expect(await bookOnline(online(), { ...request, name: "  " }, NOW)).toMatchObject({ ok: false, code: "name" });
    expect(await bookOnline(online(), { ...request, phone: "12" }, NOW)).toMatchObject({ ok: false, code: "phone" });
    expect(await bookOnline(online(), { ...request, service: "Consultation" }, NOW)).toMatchObject({
      ok: false,
      code: "service",
    });
    expect(await bookOnline(online(), { ...request, start: "2026-11-10T10:00:00Z" }, NOW)).toMatchObject({
      ok: false,
      code: "time",
    });
    expect(
      await bookOnline(online({ maxDaysAhead: 7 }), { ...request, start: "2026-11-30T10:00:00Z" }, NOW)
    ).toMatchObject({ ok: false, code: "time" });
    expect(await bookOnline(online({ takesBookings: false }), request, NOW)).toMatchObject({
      ok: false,
      code: "closed",
    });
    expect(handleBookAppointment).not.toHaveBeenCalled();
  });

  it("offers the nearest free times when the slot has gone", async () => {
    handleBookAppointment.mockResolvedValue({ success: false, conflict: true, message: "Taken." });
    free = [
      { start: "2026-11-12T09:45:00.000Z", end: "", stylistName: "Sam" },
      { start: "2026-11-12T10:30:00.000Z", end: "", stylistName: "Sam" },
    ];
    const res = await bookOnline(online(), request, NOW);
    expect(res).toMatchObject({ ok: false, status: 409, code: "taken" });
    expect(res.ok === false && res.alternatives?.map((a) => a.start)).toEqual([
      "2026-11-12T09:45:00.000Z",
      "2026-11-12T10:30:00.000Z",
    ]);
  });

  it("explains the skin test when a new client's colour is too soon", async () => {
    handleBookAppointment.mockResolvedValue({ success: false, tooSoon: true, patchTestRequired: true, message: "" });
    const res = await bookOnline(online(), { ...request, service: "Root colour", stylist: "Jo", newClient: true }, NOW);
    expect(res).toMatchObject({ ok: false, code: "too_soon" });
    expect(res.ok === false && res.error).toMatch(/skin test/);
  });

  it("never tells the client they are booked when the diary failed", async () => {
    handleBookAppointment.mockResolvedValue({ success: false, conflict: false, message: "did not go through" });
    const res = await bookOnline(online(), request, NOW);
    expect(res).toMatchObject({ ok: false, code: "failed" });
    expect(res.ok === false && res.error).toMatch(/01234 567890/);
  });
});
