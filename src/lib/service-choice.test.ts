import { describe, expect, it, vi } from "vitest";

/**
 * A request that could be several services, or none: "a blow dry" at a salon
 * with three lengths of blow dry, "balayage" at one that does not list it.
 * Found by running real calls against Shogo's price list: the booking code
 * said only "which service is that for?", and the model told a caller the
 * salon does balayage because it sounded like highlights.
 */

const services = vi.hoisted(() => {
  const s = (name: string, pounds: number, minutes = 45, patch = false) => ({
    name,
    durationMinutes: minutes,
    bufferMinutes: 0,
    requiresPatchTest: patch,
    priceMinor: pounds * 100,
  });
  return [
    s("Ladies cut and blow dry", 59, 60),
    s("Men's cut and dry", 42, 30),
    s("Wash and blow dry, short hair", 29, 30),
    s("Wash and blow dry, medium hair", 34),
    s("Wash and blow dry, long hair", 39),
    s("Roots colour", 49, 90, true),
    s("Full colour, short hair", 59, 90, true),
    s("Full colour, medium hair", 65, 105, true),
    s("Full colour, long hair", 69, 120, true),
    s("Highlights, top", 60, 90, true),
    s("Highlights, half head", 79, 120, true),
    s("Highlights, full head", 99, 150, true),
    s("Olaplex treatment", 30, 30),
    s("Children's cut, age 0 to 6", 19, 30),
    s("Children's cut, age 7 to 12", 27, 30),
    s("Children's cut, age 13 to 16", 32, 30),
  ];
});

vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findUnique: vi.fn(), findMany: vi.fn(async () => []) }, appointment: { findMany: vi.fn(async () => []) } },
}));
vi.mock("@/lib/booking", async (original) => ({
  ...(await original<typeof import("@/lib/booking")>()),
  getSalonConfig: async () => ({
    timeZone: "Europe/London",
    hours: [{ day: 5, closed: false, open: "10:00", close: "19:00" }],
    services,
    stylists: [{ name: "Jo", workingDays: [], services: [] }],
  }),
  getBookingProvider: async () => ({
    id: "native",
    capabilities: { readAvailability: true, forwardSearch: false, createBooking: true },
    getAvailability: async () => [],
    createBooking: async () => ({}),
  }),
}));

import { matchService, servicesLike } from "./salon-config";
import { handleBookAppointment, handleCheckAvailability } from "./vapi-functions";

const names = (spoken: string) => servicesLike(spoken, services).map((s) => s.name);

describe("what a vague request could mean", () => {
  it("finds every length of a blow dry, colour or highlights", () => {
    expect(names("blow dry")).toEqual([
      "Ladies cut and blow dry",
      "Wash and blow dry, short hair",
      "Wash and blow dry, medium hair",
      "Wash and blow dry, long hair",
    ]);
    expect(names("full colour")).toHaveLength(3);
    expect(names("highlights")).toEqual(["Highlights, top", "Highlights, half head", "Highlights, full head"]);
    expect(names("a highlight")).toHaveLength(3);
  });

  it("understands how callers say it", () => {
    expect(names("a haircut")).toEqual(expect.arrayContaining(["Ladies cut and blow dry", "Men's cut and dry"]));
    expect(names("kids cut")).toHaveLength(3);
    expect(names("gents cut")).toEqual(["Men's cut and dry"]);
    expect(names("hair color")).toHaveLength(4);
  });

  it("finds nothing for a service the salon does not list", () => {
    expect(names("balayage")).toEqual([]);
    expect(names("fringe trim")).toEqual([]);
  });

  it("matches men's with or without the apostrophe", () => {
    expect(matchService("mens cut", services)?.name).toBe("Men's cut and dry");
    expect(matchService("men's cut", services)?.name).toBe("Men's cut and dry");
  });
});

describe("what the receptionist is told", () => {
  it("lists the options, with prices, for a vague request instead of just asking", async () => {
    const r = (await handleCheckAvailability("org", { date: "Friday", service: "blow dry" })) as { message: string };
    expect(r.message).toContain("Wash and blow dry, short hair (from £29)");
    expect(r.message).toContain("Wash and blow dry, long hair (from £39)");
    expect(r.message).toMatch(/Ask the caller which one/);
    expect(r.message).toMatch(/Do not pick one for them/);
  });

  it("says plainly that an unlisted service is not offered", async () => {
    const r = (await handleCheckAvailability("org", { date: "Friday", service: "balayage" })) as { message: string };
    expect(r.message).toMatch(/"balayage" is not on this salon's service list/);
    expect(r.message).toMatch(/Do not say that it does/);
  });

  it("does the same when booking, and books nothing", async () => {
    const r = (await handleBookAppointment("org", {
      customerName: "Sarah Jones",
      customerPhone: "+447700900715",
      service: "highlights",
      date: "Friday",
      time: "11am",
    })) as { success: boolean; message: string };
    expect(r.success).toBe(false);
    expect(r.message).toContain("Highlights, half head (from £79)");
  });

  it("keeps what it did understand of a half-understood request", async () => {
    const r = (await handleCheckAvailability("org", { date: "Friday", service: "Roots colour and a blow dry" })) as {
      message: string;
    };
    expect(r.message).toMatch(/^I have Roots colour\. "blow dry" could be any of/);
  });
});
