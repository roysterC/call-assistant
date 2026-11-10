import { describe, expect, it } from "vitest";
import { bookingReadiness, missingText } from "./readiness";
import { selectProvider, type SalonConfig } from "./index";
import { parseBusinessHours } from "@/lib/business-hours";
import { parseServices, parseStylists } from "@/lib/salon-config";

const services = [{ name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, priceMinor: 3000 }];
const team = [{ name: "Lan", workingDays: [2, 3], services: [] }];
const hours = [{ day: 2, closed: false, open: "09:00", close: "18:00" }];

describe("whether the diary can take bookings", () => {
  it("is ready with services, a team and opening hours", () => {
    expect(bookingReadiness({ services, teamMembers: team, businessHours: hours })).toEqual({ ready: true, missing: [] });
  });

  it("says everything it lacks, in the salon's own word for the team", () => {
    const r = bookingReadiness({ services: [], teamMembers: [], businessHours: [], staff: "nail technician" });
    expect(r.ready).toBe(false);
    expect(missingText(r)).toBe("no services, no nail technicians and no opening hours");
  });

  it("is not ready when every day is closed, though the diary would accept it", () => {
    const closed = [{ day: 1, closed: true, open: "09:00", close: "17:00" }];
    expect(bookingReadiness({ services, teamMembers: team, businessHours: closed }).missing).toEqual(["closed every day"]);
  });

  it("on Google's calendars, needs someone with a calendar", () => {
    const r = bookingReadiness({ services, teamMembers: team, businessHours: hours, diaryProvider: "google" });
    expect(r.missing).toEqual(["no stylist with a Google calendar"]);
  });

  it("agrees with the booking code's own test, on the salon's own diary", () => {
    const cases = [
      { services, teamMembers: team, businessHours: hours },
      { services: [], teamMembers: team, businessHours: hours },
      { services, teamMembers: [], businessHours: hours },
      { services, teamMembers: team, businessHours: [] },
    ];
    for (const c of cases) {
      const cfg = {
        diary: "native",
        timeZone: "Europe/London",
        hours: parseBusinessHours(c.businessHours),
        services: parseServices(c.services),
        stylists: parseStylists(c.teamMembers),
        calComApiKey: null,
        calComEventTypeId: null,
      } as SalonConfig;
      expect(bookingReadiness(c).ready).toBe(selectProvider(cfg).capabilities.createBooking);
    }
  });
});
