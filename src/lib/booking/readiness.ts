/**
 * Whether a salon's diary can take bookings yet, and if not, what it lacks:
 * shown under "Book from messages" in the admin and on the salon's own
 * Settings page.
 *
 * Until it can, the phone receptionist and the chats fall back to taking
 * messages, and nothing said why: a nail salon set up for Instagram
 * answered with the plain chatbot because it had no services, no nail
 * technicians and every day closed.
 *
 * The same test as selectProvider (index.ts) for the salon's own diary, plus
 * one it lets through: a week with every day closed, which can be set up
 * and still never offer a time. Plain code, no database, so the Settings
 * page can run it on what is on screen as it is filled in.
 */

import { parseBusinessHours } from "@/lib/business-hours";
import { parseServices, parseStylists } from "@/lib/salon-config";

export interface Readiness {
  ready: boolean;
  /** What it lacks, as a few words each: "no services". */
  missing: string[];
}

export function bookingReadiness(input: {
  services: unknown;
  teamMembers: unknown;
  businessHours: unknown;
  /** "google" when the diary is the salon's Google calendars. */
  diaryProvider?: string | null;
  /** What one of the team is called: "stylist", "nail technician" (business-types.ts). */
  staff?: string;
}): Readiness {
  const services = parseServices(input.services);
  const team = parseStylists(input.teamMembers);
  const hours = parseBusinessHours(input.businessHours);
  const staff = input.staff || "stylist";

  const missing: string[] = [];
  if (services.length === 0) missing.push("no services");
  if (input.diaryProvider === "google") {
    if (!team.some((s) => s.googleCalendarId)) missing.push(`no ${staff} with a Google calendar`);
  } else if (team.length === 0) {
    missing.push(`no ${staff}s`);
  }
  if (hours.length === 0) missing.push("no opening hours");
  else if (hours.every((h) => h.closed)) missing.push("closed every day");
  return { ready: missing.length === 0, missing };
}

/** "no services, no nail technicians and no opening hours". */
export function missingText(r: Readiness): string {
  const m = r.missing;
  return m.length <= 1 ? m.join("") : `${m.slice(0, -1).join(", ")} and ${m[m.length - 1]}`;
}
