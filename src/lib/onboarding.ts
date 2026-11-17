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

/** The first step still to do: where someone coming back picks up. */
export function resumeAt(steps: readonly OnboardingStep[], d: OnboardingDraft): OnboardingStep {
  return steps.find((s) => s !== "about" && stepProblem(s, d) !== null) ?? "ready";
}
