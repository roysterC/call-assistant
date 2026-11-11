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
import { bookingReadiness } from "@/lib/booking/readiness";
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

/** Why a step cannot be left yet: the page says it in the reader's language (onb.err.*). */
export type StepProblem = "name" | "openDay" | "service" | "duration" | "team" | "notReady";

/** What stops the step being left, or null. */
export function stepProblem(step: OnboardingStep, d: OnboardingDraft): StepProblem | null {
  switch (step) {
    case "salon":
      return d.businessName.trim() ? null : "name";
    case "hours":
      return d.businessHours.some((h) => !h.closed) ? null : "openDay";
    case "services": {
      const named = d.services.filter((s) => s.name.trim());
      if (named.length === 0) return "service";
      if (named.some((s) => !(s.durationMinutes > 0))) return "duration";
      return null;
    }
    case "team":
      return d.teamMembers.some((m) => m.name.trim()) ? null : "team";
    case "about":
      return null;
    case "ready":
      return bookingReadiness({ services: d.services, teamMembers: d.teamMembers, businessHours: d.businessHours }).ready
        ? null
        : "notReady";
  }
}

/** Whether a service still has the length the starter list gave it: worth a second look. */
export function hasTypicalLength(service: SalonService, types: readonly BusinessType[]): boolean {
  const starter = starterServices(types).find((s) => s.name.toLowerCase() === service.name.trim().toLowerCase());
  return Boolean(starter && starter.durationMinutes === service.durationMinutes);
}

/** The first step still to do: where someone coming back picks up. */
export function resumeAt(steps: readonly OnboardingStep[], d: OnboardingDraft): OnboardingStep {
  return steps.find((s) => s !== "about" && stepProblem(s, d) !== null) ?? "ready";
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
