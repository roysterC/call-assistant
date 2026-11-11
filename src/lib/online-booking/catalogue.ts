/**
 * What the public booking pages may know about a salon, and the rules for the
 * settings that shape them.
 *
 * Plain code, no database: the site, the booking flow, the API and Settings
 * all build from the same functions, so the site can never offer a service
 * the API would refuse, and nothing private (stylists' emails, phone numbers,
 * calendar ids, keys) is ever handed to a browser.
 */

import type { BusinessHours } from "@/lib/business-hours";
import {
  isBookable,
  stylistsForService,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";

/** How far ahead clients can book online, in days: a day to a year. */
export const ONLINE_DAYS_AHEAD_MIN = 1;
export const ONLINE_DAYS_AHEAD_MAX = 365;
export const ONLINE_DAYS_AHEAD_DEFAULT = 56;

export const SITE_HEADLINE_MAX = 120;
export const SITE_ABOUT_MAX = 600;
export const SITE_ADDRESS_MAX = 200;

/** The brand colour when the salon has not chosen one. */
export const DEFAULT_BRAND_COLOR = "#9d3b5e";

export interface PublicService {
  name: string;
  durationMinutes: number;
  /** List price in pence, or null when the salon has set none. */
  priceMinor: number | null;
  /** New clients need a skin test 48 hours before (colour). */
  requiresPatchTest: boolean;
  /** Who can do it, when clients may choose; empty otherwise. */
  stylists: string[];
}

export interface PublicStylist {
  name: string;
  role: string | null;
}

export interface PublicSalon {
  slug: string;
  name: string;
  headline: string | null;
  about: string | null;
  address: string | null;
  phone: string | null;
  brandColor: string;
  timeZone: string;
  hours: BusinessHours;
  /** Whether a client may pick who they see, or only "anyone". */
  stylistChoice: boolean;
  maxDaysAhead: number;
  services: PublicService[];
  /** Empty when clients may not choose. */
  stylists: PublicStylist[];
}

/** "#RRGGBB" lower-cased, or null for anything else. */
export function parseBrandColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

export function parseDaysAhead(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return ONLINE_DAYS_AHEAD_DEFAULT;
  return Math.min(ONLINE_DAYS_AHEAD_MAX, Math.max(ONLINE_DAYS_AHEAD_MIN, Math.round(n)));
}

/** Trimmed text up to `max` characters; null when blank or not text. */
export function parseSiteText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\r\n/g, "\n").trim().slice(0, max);
  return v ? v : null;
}

/** Service names, trimmed, without blanks or repeats. */
export function parseHiddenServices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const name = v.trim().slice(0, 200);
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/** Whether `service` is hidden from online booking. Names compare ignoring case. */
export function isHiddenOnline(service: string, hidden: string[]): boolean {
  const s = service.trim().toLowerCase();
  return hidden.some((h) => h.trim().toLowerCase() === s);
}

/**
 * The services clients can book online: not hidden, and somebody bookable
 * does them. A service nobody can be booked for would only ever show "no
 * times", so it is left off rather than offered.
 */
export function onlineServices(
  services: SalonService[],
  stylists: Stylist[],
  hidden: string[]
): SalonService[] {
  return services.filter(
    (s) => !isHiddenOnline(s.name, hidden) && stylistsForService(s, stylists).length > 0
  );
}

/** The salon as the public pages see it. */
export function buildPublicSalon(input: {
  slug: string;
  name: string;
  headline?: string | null;
  about?: string | null;
  address?: string | null;
  phone?: string | null;
  brandColor?: string | null;
  timeZone: string;
  hours: BusinessHours;
  services: SalonService[];
  stylists: Stylist[];
  hiddenServices: string[];
  stylistChoice: boolean;
  maxDaysAhead: number;
}): PublicSalon {
  const bookable = input.stylists.filter(isBookable);
  const services = onlineServices(input.services, bookable, input.hiddenServices);
  const choice = input.stylistChoice && bookable.length > 1;
  return {
    slug: input.slug,
    name: input.name,
    headline: input.headline ?? null,
    about: input.about ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    brandColor: parseBrandColor(input.brandColor) ?? DEFAULT_BRAND_COLOR,
    timeZone: input.timeZone,
    hours: input.hours,
    stylistChoice: choice,
    maxDaysAhead: parseDaysAhead(input.maxDaysAhead),
    services: services.map((s) => ({
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceMinor: s.priceMinor,
      requiresPatchTest: s.requiresPatchTest,
      stylists: choice ? stylistsForService(s, bookable).map((p) => p.name) : [],
    })),
    stylists: choice
      ? bookable
          // Only people who do something that can be booked online.
          .filter((p) => services.some((s) => stylistsForService(s, [p]).length > 0))
          .map((p) => ({ name: p.name, role: p.role?.trim() || null }))
      : [],
  };
}

/** A service on the public list, matched by name ignoring case. */
export function findPublicService(salon: PublicSalon, name: unknown): PublicService | null {
  if (typeof name !== "string") return null;
  const n = name.trim().toLowerCase();
  return salon.services.find((s) => s.name.toLowerCase() === n) ?? null;
}
