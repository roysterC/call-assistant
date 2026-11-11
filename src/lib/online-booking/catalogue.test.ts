import { describe, expect, it } from "vitest";
import {
  buildPublicSalon,
  DEFAULT_BRAND_COLOR,
  findPublicService,
  isHiddenOnline,
  onlineServices,
  parseBrandColor,
  parseDaysAhead,
  parseHiddenServices,
  parseSiteText,
} from "./catalogue";
import { parseBusinessHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";

const CUT: SalonService = { name: "Cut & blow dry", durationMinutes: 60, requiresPatchTest: false, priceMinor: 4500 };
const COLOUR: SalonService = { name: "Root colour", durationMinutes: 90, requiresPatchTest: true, priceMinor: 6000 };
const CONSULT: SalonService = { name: "Consultation", durationMinutes: 15, requiresPatchTest: false, priceMinor: null };
const NAILS: SalonService = { name: "Gel nails", durationMinutes: 45, requiresPatchTest: false, priceMinor: 3000 };

const JO: Stylist = {
  name: "Jo",
  role: "Colourist",
  email: "jo@example.com",
  phone: "07700900001",
  bookable: true,
  workingDays: [],
  services: ["Root colour", "Consultation"],
};
const SAM: Stylist = { name: "Sam", bookable: true, workingDays: [], services: [] };
const OFF: Stylist = { name: "Lee", bookable: false, workingDays: [], services: ["Gel nails"] };

const HOURS = parseBusinessHours([{ day: 2, closed: false, open: "09:00", close: "17:30" }]);

function salon(over: Partial<Parameters<typeof buildPublicSalon>[0]> = {}) {
  return buildPublicSalon({
    slug: "maison-hair",
    name: "Maison Hair",
    timeZone: "Europe/London",
    hours: HOURS,
    services: [CUT, COLOUR, CONSULT, NAILS],
    stylists: [JO, SAM, OFF],
    hiddenServices: ["consultation"],
    stylistChoice: true,
    maxDaysAhead: 56,
    ...over,
  });
}

describe("online services", () => {
  it("leaves out hidden services, ignoring case", () => {
    expect(isHiddenOnline("Consultation", ["consultation "])).toBe(true);
    expect(onlineServices([CUT, CONSULT], [SAM], ["CONSULTATION"]).map((s) => s.name)).toEqual(["Cut & blow dry"]);
  });

  it("leaves out services nobody bookable does", () => {
    expect(onlineServices([CUT, NAILS], [JO, OFF], []).map((s) => s.name)).toEqual([]);
    expect(onlineServices([CUT, NAILS], [SAM, OFF], []).map((s) => s.name)).toEqual(["Cut & blow dry", "Gel nails"]);
  });
});

describe("buildPublicSalon", () => {
  it("lists bookable services with who does them", () => {
    const s = salon();
    expect(s.services.map((x) => x.name)).toEqual(["Cut & blow dry", "Root colour", "Gel nails"]);
    expect(findPublicService(s, "root colour")?.stylists).toEqual(["Jo", "Sam"]);
    expect(findPublicService(s, "Cut & blow dry")?.stylists).toEqual(["Sam"]);
  });

  it("never hands a browser the team's contact details or calendars", () => {
    const json = JSON.stringify(salon());
    expect(json).not.toContain("jo@example.com");
    expect(json).not.toContain("07700900001");
    expect(json).not.toContain("Lee");
    expect(salon().stylists).toEqual([
      { name: "Jo", role: "Colourist" },
      { name: "Sam", role: null },
    ]);
  });

  it("offers no choice of stylist when the salon says no, or has only one", () => {
    const off = salon({ stylistChoice: false });
    expect(off.stylistChoice).toBe(false);
    expect(off.stylists).toEqual([]);
    expect(off.services.every((x) => x.stylists.length === 0)).toBe(true);
    expect(salon({ stylists: [SAM] }).stylistChoice).toBe(false);
  });

  it("falls back to the default colour and a sane booking window", () => {
    expect(salon({ brandColor: "red" }).brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(salon({ brandColor: "#1F4E5F" }).brandColor).toBe("#1f4e5f");
    expect(salon({ maxDaysAhead: 9999 }).maxDaysAhead).toBe(365);
  });

  it("finds no service that is not online", () => {
    expect(findPublicService(salon(), "Consultation")).toBeNull();
    expect(findPublicService(salon(), 42)).toBeNull();
  });
});

describe("settings parsers", () => {
  it("parseBrandColor takes only #rrggbb", () => {
    expect(parseBrandColor(" #ABCDEF ")).toBe("#abcdef");
    expect(parseBrandColor("#abc")).toBeNull();
    expect(parseBrandColor("javascript:alert(1)")).toBeNull();
    expect(parseBrandColor(null)).toBeNull();
  });

  it("parseDaysAhead clamps and defaults", () => {
    expect(parseDaysAhead(0)).toBe(1);
    expect(parseDaysAhead("28")).toBe(28);
    expect(parseDaysAhead("soon")).toBe(56);
    expect(parseDaysAhead(1000)).toBe(365);
  });

  it("parseSiteText trims, caps and blanks to null", () => {
    expect(parseSiteText("  Hello  ", 10)).toBe("Hello");
    expect(parseSiteText("   ", 10)).toBeNull();
    expect(parseSiteText("abcdefghijkl", 5)).toBe("abcde");
    expect(parseSiteText(5, 10)).toBeNull();
  });

  it("parseHiddenServices drops blanks, repeats and non-text", () => {
    expect(parseHiddenServices([" Consultation", "consultation", "", 3, "Bridal"])).toEqual(["Consultation", "Bridal"]);
    expect(parseHiddenServices("Consultation")).toEqual([]);
  });
});
