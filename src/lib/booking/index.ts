/**
 * Booking provider resolution.
 *
 * The only place that decides which diary an organization is on. Everything
 * downstream asks the provider what it can do rather than checking settings
 * itself, so adding a provider does not mean auditing call sites.
 */

import { prisma } from "@/lib/prisma";
import {
  parseBusinessHours,
  parseTimezone,
  type BusinessHours,
} from "@/lib/business-hours";
import {
  parseServices,
  parseStylists,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";
import { createCalComProvider } from "./providers/calcom";
import {
  createGoogleProvider,
  googleCredentialsConfigured,
} from "./providers/google";
import { manualProvider } from "./providers/manual";
import { createNativeProvider } from "./providers/native";
import type { BookingProvider } from "./types";

export * from "./types";
export { computeBookableSlots, summariseSlotsForSpeech, earliestBookableStart } from "./availability";

export type DiaryMode = "native" | "google";

export interface SalonConfig {
  /** Where the diary lives. See OrganizationSettings.diaryProvider. */
  diary: DiaryMode;
  timeZone: string;
  hours: BusinessHours;
  services: SalonService[];
  stylists: Stylist[];
  calComApiKey: string | null;
  calComEventTypeId: string | null;
}

/**
 * Read and validate an organization's diary configuration.
 *
 * Everything is parsed through the strict validators rather than trusted as
 * stored — `PUT /api/settings` accepts a broad payload, and these values feed
 * both booking arithmetic and generated prompt text.
 */
export async function getSalonConfig(
  organizationId: string
): Promise<SalonConfig> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: {
      businessHours: true,
      timezone: true,
      services: true,
      teamMembers: true,
      calComApiKey: true,
      calComEventTypeId: true,
      diaryProvider: true,
    },
  });

  const diary: DiaryMode =
    settings?.diaryProvider === "google" ? "google" : "native";

  return {
    diary,
    timeZone: parseTimezone(settings?.timezone),
    hours: parseBusinessHours(settings?.businessHours),
    services: parseServices(settings?.services),
    // On our own diary everyone on the team can be booked; on Google, only
    // those whose calendar is shared with us.
    stylists: parseStylists(settings?.teamMembers).map((s) => ({
      ...s,
      bookable: diary === "native" || Boolean(s.googleCalendarId),
    })),
    calComApiKey: settings?.calComApiKey ?? null,
    calComEventTypeId: settings?.calComEventTypeId ?? null,
  };
}

/**
 * Pick a provider from what is actually configured.
 *
 * A salon's own diary needs a team, service durations and opening hours:
 * without durations we cannot know how much of the day to block, and a
 * half-configured salon must fall through to `manual` and take requests rather
 * than book at the wrong length. Google needs all that plus its credentials
 * and at least one stylist calendar, and is only used when the salon has been
 * set to it.
 *
 * `manual` is the fallback and it is honest, not degraded: it exposes no
 * availability method at all.
 */
export function selectProvider(cfg: SalonConfig): BookingProvider {
  const configured = cfg.services.length > 0 && cfg.hours.length > 0;

  if (cfg.diary === "native" && configured && cfg.stylists.length > 0) {
    return createNativeProvider({
      timeZone: cfg.timeZone,
      hours: cfg.hours,
      services: cfg.services,
      stylists: cfg.stylists,
    });
  }

  const hasBookableStylists = cfg.stylists.some((s) => s.googleCalendarId);

  if (
    cfg.diary === "google" &&
    googleCredentialsConfigured() &&
    hasBookableStylists &&
    cfg.services.length > 0 &&
    cfg.hours.length > 0
  ) {
    return createGoogleProvider({
      timeZone: cfg.timeZone,
      hours: cfg.hours,
      services: cfg.services,
      stylists: cfg.stylists,
    });
  }

  if (cfg.calComApiKey && cfg.calComEventTypeId) {
    return createCalComProvider({
      apiKey: cfg.calComApiKey,
      eventTypeId: cfg.calComEventTypeId,
      timeZone: cfg.timeZone,
    });
  }

  return manualProvider;
}

export async function getBookingProvider(
  organizationId: string
): Promise<BookingProvider> {
  return selectProvider(await getSalonConfig(organizationId));
}

/**
 * Why an organization is not on a booking provider it looks like it should be.
 *
 * Surfaced on the admin sync screen — "Google is configured but nothing is
 * bookable" is otherwise a silent state that only shows up as the agent
 * refusing to check availability at midnight.
 */
export function explainProviderSelection(cfg: SalonConfig): string[] {
  const notes: string[] = [];
  if (cfg.diary === "native") {
    if (cfg.stylists.length === 0) notes.push("No stylists are configured.");
    if (cfg.services.length === 0) {
      notes.push("No services configured, so appointment durations are unknown.");
    }
    if (cfg.hours.length === 0) notes.push("Opening hours are not configured.");
    return notes;
  }
  if (!googleCredentialsConfigured()) {
    notes.push(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY are not set."
    );
  }
  if (!cfg.stylists.some((s) => s.googleCalendarId)) {
    notes.push("No stylist has a Google calendar id configured.");
  }
  if (cfg.services.length === 0) {
    notes.push("No services configured, so appointment durations are unknown.");
  }
  if (cfg.hours.length === 0) {
    notes.push("Opening hours are not configured.");
  }
  return notes;
}
