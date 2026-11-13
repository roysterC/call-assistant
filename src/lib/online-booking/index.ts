/**
 * Online booking: the salon's own website (/s/<slug>), and the same booking
 * flow as a link or embed on a website the salon already has
 * (/embed/book/<slug>, public/book.js).
 *
 * Nothing here decides what may be booked. Free times come from the same
 * provider and slot engine as the phone receptionist, and a booking goes
 * through the receptionist's own handleBookAppointment: every rule a phone
 * booking is held to (opening hours, rotas, blocked time, the skin-test wait,
 * the locked diary write that refuses a double booking), the client record,
 * the booking number, the salon's pop-up and the confirmation text. This
 * module only adds what is particular to the web: which services are online,
 * how far ahead, whether clients choose who they see, and saying the outcome
 * to a client rather than to a voice agent.
 */

import { prisma } from "@/lib/prisma";
import {
  canCreateBooking,
  canReadAvailability,
  getSalonConfig,
  selectProvider,
  type BookingProvider,
  type SalonConfig,
} from "@/lib/booking";
import { normalisePhone } from "@/lib/phone";
import { addCalendarDays, zonedDateString } from "@/lib/business-hours";
import { normaliseCallerName } from "@/lib/caller-name";
import { handleBookAppointment } from "@/lib/receptionist/booking";
import {
  buildPublicSalon,
  findPublicService,
  parseHiddenServices,
  type PublicSalon,
  type PublicService,
} from "./catalogue";
import { groupSlotsByDay, nearestSlots, slotWindow, type DaySlots, type PublicSlot } from "./slots";

export * from "./catalogue";
export * from "./slots";

export interface OnlineSalon {
  organizationId: string;
  salon: PublicSalon;
  cfg: SalonConfig;
  provider: BookingProvider;
  /** The diary can show free times and take a booking. */
  takesBookings: boolean;
}

/** Slugs are lower-case letters, digits and hyphens. */
export function isSlug(raw: unknown): raw is string {
  return typeof raw === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(raw);
}

/**
 * The salon at /s/<slug>, or null when there is none, it is switched off, or
 * it has not turned online booking on. A salon that has turned it on but
 * whose diary is not set up yet still has a site; it just cannot be booked
 * (`takesBookings` false), and says to ring.
 */
export async function loadOnlineSalon(slug: unknown): Promise<OnlineSalon | null> {
  if (!isSlug(slug)) return null;
  const org = await prisma.organization.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      enabled: true,
      settings: {
        select: {
          businessName: true,
          contactPhone: true,
          onlineBookingEnabled: true,
          siteHeadline: true,
          siteAbout: true,
          siteAddress: true,
          siteBrandColor: true,
          onlineMaxDaysAhead: true,
          onlineStylistChoice: true,
          onlineHiddenServices: true,
        },
      },
    },
  });
  const s = org?.settings;
  if (!org || !org.enabled || !s?.onlineBookingEnabled) return null;

  const cfg = await getSalonConfig(org.id);
  const provider = selectProvider(cfg);
  const salon = buildPublicSalon({
    slug: org.slug,
    name: s.businessName || org.name,
    headline: s.siteHeadline,
    about: s.siteAbout,
    address: s.siteAddress,
    phone: s.contactPhone,
    brandColor: s.siteBrandColor,
    timeZone: cfg.timeZone,
    hours: cfg.hours,
    services: cfg.services,
    stylists: cfg.stylists,
    hiddenServices: parseHiddenServices(s.onlineHiddenServices),
    stylistChoice: s.onlineStylistChoice,
    maxDaysAhead: s.onlineMaxDaysAhead,
  });
  return {
    organizationId: org.id,
    salon,
    cfg,
    provider,
    takesBookings:
      canCreateBooking(provider) && canReadAvailability(provider) && salon.services.length > 0,
  };
}

/** A stylist on the public list who does `service`, or null for "anyone". */
function chosenStylist(salon: PublicSalon, service: PublicService, raw: unknown): string | null {
  if (!salon.stylistChoice || typeof raw !== "string") return null;
  const n = raw.trim().toLowerCase();
  return service.stylists.find((s) => s.toLowerCase() === n) ?? null;
}

export type AvailabilityResult =
  | { ok: true; days: DaySlots[]; from: string; next: string | null; lastDate: string }
  | { ok: false; status: number; error: string };

/**
 * A week of free times for `service` from `from`. A new client's colour is
 * only offered times after the skin-test wait, exactly as by phone.
 */
export async function onlineAvailability(
  online: OnlineSalon,
  q: { service: unknown; stylist?: unknown; from?: unknown; newClient?: boolean },
  now: Date = new Date()
): Promise<AvailabilityResult> {
  if (!online.takesBookings || !canReadAvailability(online.provider)) {
    return { ok: false, status: 409, error: "Online booking is not open just now." };
  }
  const service = findPublicService(online.salon, q.service);
  if (!service) return { ok: false, status: 404, error: "That service cannot be booked online." };

  const window = slotWindow(
    typeof q.from === "string" ? q.from : null,
    online.salon.maxDaysAhead,
    online.salon.timeZone,
    now
  );
  if (!window) return { ok: true, days: [], from: "", next: null, lastDate: "" };

  const stylist = chosenStylist(online.salon, service, q.stylist);
  const slots = await online.provider.getAvailability({
    organizationId: online.organizationId,
    date: window.from,
    serviceName: service.name,
    stylistName: stylist ?? undefined,
    clientType: service.requiresPatchTest ? (q.newClient ? "new" : "returning") : "unknown",
    searchDays: window.days,
    maxDaysWithSlots: window.days,
  });

  // The window stops at the last day the salon takes online bookings for,
  // so the engine is never asked past it.
  const days = groupSlotsByDay(slots, window, online.salon.timeZone, online.salon.hours);
  const nextFrom = addCalendarDays(window.from, window.days);
  const next = nextFrom <= window.lastDate ? nextFrom : null;
  return { ok: true, days, from: window.from, next, lastDate: window.lastDate };
}

export interface OnlineBookingRequest {
  service: unknown;
  /** ISO instant of the slot chosen. */
  start: unknown;
  stylist?: unknown;
  name: unknown;
  phone: unknown;
  /** For colour: a new client to the salon. */
  newClient?: unknown;
  notes?: unknown;
}

export type OnlineBookingResult =
  | {
      ok: true;
      bookingNumber: number | null;
      start: string;
      service: string;
      stylist: string;
      name: string;
      textSent: boolean;
      skinTest: boolean;
    }
  | {
      ok: false;
      status: number;
      /** What went wrong, for the page to choose what to show. */
      code: "closed" | "service" | "name" | "phone" | "time" | "taken" | "too_soon" | "failed";
      error: string;
      /** For "taken" and "too_soon": the nearest times still free. */
      alternatives?: PublicSlot[];
    };

const NOTES_MAX = 500;

/** Book a slot chosen online, into the salon's diary. */
export async function bookOnline(
  online: OnlineSalon,
  req: OnlineBookingRequest,
  now: Date = new Date()
): Promise<OnlineBookingResult> {
  const call = online.salon.phone ? ` Please ring the salon on ${online.salon.phone}.` : "";
  if (!online.takesBookings) {
    return { ok: false, status: 409, code: "closed", error: `Online booking is not open just now.${call}` };
  }
  const service = findPublicService(online.salon, req.service);
  if (!service) {
    return { ok: false, status: 400, code: "service", error: "That service cannot be booked online." };
  }

  const name = normaliseCallerName(typeof req.name === "string" ? req.name : "");
  if (!name.ok) return { ok: false, status: 400, code: "name", error: "Please enter your name." };
  const phone = normalisePhone(typeof req.phone === "string" ? req.phone : "");
  if (!phone.ok) {
    return { ok: false, status: 400, code: "phone", error: "That mobile number does not look right." };
  }

  const start = typeof req.start === "string" ? new Date(req.start) : null;
  if (!start || Number.isNaN(start.getTime()) || start.getTime() < now.getTime()) {
    return { ok: false, status: 400, code: "time", error: "Please choose a time." };
  }
  const window = slotWindow(null, online.salon.maxDaysAhead, online.salon.timeZone, now);
  if (!window || zonedDateString(start, online.salon.timeZone) > window.lastDate) {
    return { ok: false, status: 400, code: "time", error: "That is further ahead than you can book online." };
  }

  const newClient = service.requiresPatchTest && req.newClient === true;
  const notes = typeof req.notes === "string" ? req.notes.trim().slice(0, NOTES_MAX) : "";
  const stylist = chosenStylist(online.salon, service, req.stylist);

  const result = (await handleBookAppointment(
    online.organizationId,
    {
      time: start.toISOString(),
      service: service.name,
      stylist: stylist ?? undefined,
      customerPhone: phone.e164,
      customerName: name.name,
      ...(service.requiresPatchTest ? { clientType: newClient ? "new" : "returning" } : {}),
      notes: notes || undefined,
    },
    { source: "website" }
  )) as Record<string, unknown>;

  if (result.success === true) {
    return {
      ok: true,
      bookingNumber: (result.bookingNumber as number | null) ?? null,
      start: start.toISOString(),
      service: String(result.service ?? service.name),
      stylist: String(result.stylist ?? stylist ?? ""),
      name: name.name,
      textSent: result.textSent === true,
      skinTest: result.patchTestRequired === true,
    };
  }

  return explainRefusal(online, service, stylist, start, newClient, result, call, now);
}

/** A refusal from handleBookAppointment, said to the client. */
async function explainRefusal(
  online: OnlineSalon,
  service: PublicService,
  stylist: string | null,
  start: Date,
  newClient: boolean,
  r: Record<string, unknown>,
  call: string,
  now: Date
): Promise<OnlineBookingResult> {
  if (r.badPhone) {
    return { ok: false, status: 400, code: "phone", error: "That mobile number does not look right." };
  }
  if (r.missingName) return { ok: false, status: 400, code: "name", error: "Please enter your name." };

  // The diary itself failed, after the checks passed: the receptionist has
  // filed a callback, so the salon will ring. Not a time to offer another.
  if (r.conflict === false) {
    return {
      ok: false,
      status: 502,
      code: "failed",
      error: `Sorry, we could not confirm that booking. The salon will be in touch to sort it out.${call}`,
    };
  }

  const taken = r.conflict === true || r.notAvailable === true;
  const tooSoon = r.tooSoon === true;
  if (taken || tooSoon) {
    const alternatives = await alternativesNear(online, service, stylist, start, newClient, now).catch(() => []);
    return tooSoon && r.patchTestRequired
      ? {
          ok: false,
          status: 409,
          code: "too_soon",
          error:
            "New colour clients need a skin test at least 48 hours before, so that time is too soon. Please choose a later one.",
          alternatives,
        }
      : {
          ok: false,
          status: 409,
          code: "taken",
          error: "Sorry, that time has just gone.",
          alternatives,
        };
  }

  console.warn("[ONLINE BOOKING] Refused:", r.message);
  return {
    ok: false,
    status: 409,
    code: "failed",
    error: `Sorry, that could not be booked online.${call}`,
  };
}

/** The free times nearest a time that has gone, from that day on. */
async function alternativesNear(
  online: OnlineSalon,
  service: PublicService,
  stylist: string | null,
  start: Date,
  newClient: boolean,
  now: Date
): Promise<PublicSlot[]> {
  const day = zonedDateString(start, online.salon.timeZone);
  // The same clock as the booking it stands in for, or a test (or a request
  // that crosses midnight) asks about one day and is answered about another.
  const res = await onlineAvailability(online, { service: service.name, stylist, from: day, newClient }, now);
  return res.ok ? nearestSlots(res.days, start.toISOString()) : [];
}
