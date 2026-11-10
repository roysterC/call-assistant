/**
 * Onboarding: a salon's owner setting it up themselves, after accepting their
 * invite (src/lib/invitations.ts). Steps, in order, each saved as it is left
 * so closing the tab loses nothing:
 *
 *   salon    its name, and what kind of salon it is
 *   hours    opening hours, and the number texts tell clients to ring
 *   services what it offers, how long each takes, and prices
 *   team     who works there, which days, doing what
 *   about    address, parking, policies: for the receptionist and chats.
 *            Optional, and only when the salon has either.
 *   ready    a last look, then Finish
 *
 * Plain code, no database, so the page and the API share the rules.
 */

import { starterServices, type BusinessType } from "@/lib/business-types";
import { bookingReadiness, missingText } from "@/lib/booking/readiness";
import type { DayHours } from "@/lib/business-hours";
import type { SalonService, Stylist } from "@/lib/salon-config";

export const ONBOARDING_STEPS = ["salon", "hours", "services", "team", "about", "ready"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The steps this salon goes through: "about" only when something answers customers. */
export function stepsFor(answersCustomers: boolean): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((s) => s !== "about" || answersCustomers);
}

export interface OnboardingDraft {
  businessName: string;
  businessHours: DayHours[];
  services: SalonService[];
  teamMembers: Stylist[];
}

/**
 * What stops the step being left, in a sentence, or null. `staff` is the
 * salon's word for one of its team ("stylist", "nail technician").
 */
export function stepProblem(step: OnboardingStep, d: OnboardingDraft, staff = "stylist"): string | null {
  switch (step) {
    case "salon":
      return d.businessName.trim() ? null : "Enter your salon's name.";
    case "hours":
      return d.businessHours.some((h) => !h.closed) ? null : "Open at least one day.";
    case "services": {
      const named = d.services.filter((s) => s.name.trim());
      if (named.length === 0) return "Add at least one service.";
      if (named.some((s) => !(s.durationMinutes > 0))) return "Give every service how long it takes.";
      return null;
    }
    case "team":
      return d.teamMembers.some((m) => m.name.trim()) ? null : `Add at least one ${staff}.`;
    case "about":
      return null;
    case "ready": {
      const r = bookingReadiness({
        services: d.services,
        teamMembers: d.teamMembers,
        businessHours: d.businessHours,
        staff,
      });
      return r.ready ? null : `Your diary can't take bookings yet: ${missingText(r)}.`;
    }
  }
}

/** The first step still to do: where someone coming back picks up. */
export function resumeAt(steps: readonly OnboardingStep[], d: OnboardingDraft, staff?: string): OnboardingStep {
  return steps.find((s) => s !== "about" && stepProblem(s, d, staff) !== null) ?? "ready";
}

/**
 * The salon's price list after its type changes. The starter list is swapped
 * for the new type's while it is still the one it was given; once the owner
 * has made it their own, it is theirs and is left alone (null).
 */
export function servicesAfterTypeChange(
  current: readonly SalonService[],
  from: readonly BusinessType[],
  to: readonly BusinessType[]
): SalonService[] | null {
  const key = (list: readonly SalonService[]) =>
    JSON.stringify(list.map((s) => [s.name, s.durationMinutes, s.priceMinor ?? null]));
  const untouched = current.length === 0 || key(current) === key(starterServices(from));
  if (!untouched) return null;
  const next = starterServices(to);
  return key(next) === key(current) ? null : next;
}
