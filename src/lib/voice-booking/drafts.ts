/**
 * Booking by voice: what the person at the desk asked for, as a card on the
 * screen, and nothing in the diary until they say yes.
 *
 * Everything the assistant can do ends here as a draft: a booking, a move or
 * a cancellation, checked against the same rules as the phone and shown to
 * the person who asked for it. Only `commitDraft` writes, and only the route
 * calls it, after a plain "yes" or a tap on Save. The model has no way to
 * reach it.
 *
 * Rules, as the proposal set them: the diary is checked live, services take
 * their proper length, stylists only do what they do and only on the days
 * they work, a new client's colour waits for the 48-hour skin test, and a
 * booking never lands on another or in blocked time. Where the desk differs
 * from the phone it is because the person is standing in the salon: a
 * walk-in can be booked for now, any clock time will do, and staff can say a
 * skin test has been done.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  canCreateBooking,
  earliestBookableStart,
  getBookingProvider,
  getSalonConfig,
  type SalonConfig,
} from "@/lib/booking";
import { bookAppointment, findBlockClash, findClash, moveAppointment } from "@/lib/booking/diary";
import {
  parseDateOnly,
  parseSpokenTime,
  resolveSpokenDate,
  zonedDateString,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import { clientForBooking } from "@/lib/client-link";
import { namesMatch } from "@/lib/client-name";
import { normalisePhone } from "@/lib/phone";
import { matchStylist, resolveBookedService, type SalonService, type Stylist } from "@/lib/salon-config";
import { canWriteColumn, type TenantContext } from "@/lib/tenant";
import { phoneSlotProblem, stylistServiceProblem } from "@/lib/vapi-functions";

/** Who is asking, as far as drafting cares. */
export type Asker = Pick<TenantContext, "organizationId" | "role" | "stylist">;

interface DraftBase {
  id: string;
  /** Who it is for, as the card shows it. */
  clientName: string;
  service: string;
  stylist: string;
  startsAt: string;
  endsAt: string;
}

export interface BookDraft extends DraftBase {
  kind: "book";
  leadId: string | null;
  /** For a client not yet on the books. */
  newClient: { name: string; phone: string | null } | null;
  durationMinutes: number;
  clientType: "new" | "returning";
  patchTestRequired: boolean;
  notes: string | null;
}

export interface MoveDraft extends DraftBase {
  kind: "move";
  appointmentId: string;
  from: { startsAt: string; stylist: string };
  durationMinutes: number;
}

export interface CancelDraft extends DraftBase {
  kind: "cancel";
  appointmentId: string;
}

export type Draft = BookDraft | MoveDraft | CancelDraft;

export type Proposal = { ok: true; draft: Draft } | { ok: false; message: string; [k: string]: unknown };

/** Booking into the last few minutes is fine (the client is in the chair); earlier is a mistake. */
const PAST_GRACE_MS = 15 * 60_000;

// --- Finding things ------------------------------------------------------------------

/**
 * Clients whose name matches what was heard, best first. The name comes
 * through speech recognition, so each word is matched on its own and a
 * near miss on one ("Jon" for "John") still finds the other.
 */
export async function findClients(organizationId: string, heard: string) {
  const words = heard
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 4);
  if (words.length === 0) return [];
  const rows = await prisma.lead.findMany({
    where: {
      organizationId,
      OR: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      contactLead: { select: { name: true, phone: true } },
      appointments: {
        where: { status: { in: ["booked", "completed"] } },
        select: { startsAt: true, status: true },
        orderBy: { startsAt: "desc" },
        take: 1,
      },
    },
    take: 25,
  });
  const score = (name: string | null) => {
    if (namesMatch(name, heard)) return 100;
    const have = (name ?? "").toLowerCase();
    return words.filter((w) => have.includes(w)).length;
  };
  return rows
    .filter((r) => r.name)
    .sort((a, b) => score(b.name) - score(a.name))
    .slice(0, 5)
    .map((r) => {
      const phone = r.phone ?? r.contactLead?.phone ?? null;
      return {
        clientId: r.id,
        name: r.name!,
        phoneEnding: phone ? phone.slice(-3) : null,
        reachedThrough: r.contactLead?.name ?? null,
        lastVisit: r.appointments[0]?.startsAt.toISOString().slice(0, 10) ?? null,
        exactMatch: namesMatch(r.name, heard),
      };
    });
}

/** A client's upcoming bookings, for moving or cancelling one. */
export async function upcomingBookings(asker: Asker, clientId: string, cfg?: SalonConfig) {
  const salon = cfg ?? (await getSalonConfig(asker.organizationId));
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId: asker.organizationId,
      leadId: clientId,
      status: "booked",
      startsAt: { gte: new Date(Date.now() - PAST_GRACE_MS) },
    },
    orderBy: { startsAt: "asc" },
    take: 8,
  });
  return rows.map((a) => ({
    appointmentId: a.id,
    bookingNumber: a.bookingNumber,
    when: spokenWhen(a.startsAt, salon.timeZone),
    service: a.serviceText,
    stylist: a.stylistName,
    yours: canWriteColumn(asker as TenantContext, a.stylistName),
  }));
}

// --- Checking a slot -------------------------------------------------------------------

/** The day and time said, as an instant in the salon's clock; or why not. */
function resolveWhen(
  cfg: SalonConfig,
  date: string | undefined,
  time: string | undefined,
  defaultDate?: string
): { ok: true; at: Date } | { ok: false; message: string } {
  const day = date ? resolveSpokenDate(date, cfg.timeZone) : defaultDate ?? null;
  if (!day) return { ok: false, message: `Which day? "${date ?? ""}" is not a day I can place.` };
  const clock = parseSpokenTime(time);
  if (!clock) return { ok: false, message: `What time? "${time ?? ""}" is not a time I can read.` };
  const d = parseDateOnly(day);
  const [h, m] = clock.split(":").map(Number);
  return { ok: true, at: zonedWallTimeToUtc(d.year, d.month, d.day, h, m, cfg.timeZone) };
}

/** Why `service` cannot go at `startsAt` with `stylist`, or null. */
async function slotProblem(
  asker: Asker,
  cfg: SalonConfig,
  startsAt: Date,
  service: SalonService,
  stylist: Stylist,
  excludeAppointmentId?: string
): Promise<string | null> {
  if (startsAt.getTime() < Date.now() - PAST_GRACE_MS) return "That time has already gone.";
  if (!canWriteColumn(asker as TenantContext, stylist.name)) {
    return `You can only book into your own column, not ${stylist.name}'s.`;
  }
  const pairing = stylistServiceProblem(stylist.name, service, cfg.stylists);
  if (pairing) return pairing.replace(/ Offer that, or ask whether they wanted a different service\.$/, "");
  const provider = await getBookingProvider(asker.organizationId);
  const hours = await phoneSlotProblem(provider, asker.organizationId, cfg, startsAt, service, stylist, {
    offeredOnly: false,
  });
  if (hours) return hours.replace(/ (Offer|Call) .*$/, "");
  const endsAt = new Date(startsAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000);
  const clash = await findClash(prisma, asker.organizationId, stylist.name, startsAt, endsAt, excludeAppointmentId);
  if (clash) {
    return `${stylist.name} already has ${clash.serviceText.toLowerCase()} at ${spokenTime(clash.startsAt, cfg.timeZone)}.`;
  }
  const block = await findBlockClash(prisma, asker.organizationId, stylist.name, startsAt, endsAt);
  if (block) return block.stylistName === null ? "The salon is closed then." : `${stylist.name} is not available then.`;
  return null;
}

/**
 * The first stylist, in team order, who does the service and is free then;
 * or, when nobody is, the reason, if it is the same for everyone who does it
 * ("The salon is closed then" says more than "nobody is free").
 */
async function anyFreeStylist(
  asker: Asker,
  cfg: SalonConfig,
  startsAt: Date,
  service: SalonService
): Promise<{ stylist: Stylist } | { reason: string }> {
  const reasons = new Set<string>();
  for (const s of cfg.stylists) {
    if (s.bookable === false) continue;
    if (stylistServiceProblem(s.name, service, cfg.stylists)) continue;
    const why = await slotProblem(asker, cfg, startsAt, service, s);
    if (!why) return { stylist: s };
    if (!/already has/.test(why)) reasons.add(why.replace(new RegExp(`^${s.name}\\b`), "Everyone"));
  }
  return {
    reason:
      reasons.size === 1 && ![...reasons][0].startsWith("Everyone")
        ? [...reasons][0]
        : `Nobody who does ${service.name.toLowerCase()} is free then.`,
  };
}

// --- Drafting ----------------------------------------------------------------------------

export interface BookingRequest {
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  service?: string;
  stylist?: string;
  date?: string;
  time?: string;
  /** Staff saying the client has had their skin test. */
  skinTestDone?: boolean;
  notes?: string;
}

export async function proposeBooking(asker: Asker, req: BookingRequest): Promise<Proposal> {
  const cfg = await getSalonConfig(asker.organizationId);
  const provider = await getBookingProvider(asker.organizationId);
  if (!canCreateBooking(provider)) return { ok: false, message: "This diary is not set up to take bookings yet." };

  // Who it is for.
  let leadId: string | null = null;
  let clientName: string;
  let newClient: BookDraft["newClient"] = null;
  if (req.clientId) {
    const lead = await prisma.lead.findFirst({ where: { id: req.clientId, organizationId: asker.organizationId } });
    if (!lead) return { ok: false, message: "That client was not found. Look them up again." };
    leadId = lead.id;
    clientName = lead.name ?? "Client";
  } else {
    const name = req.clientName?.trim();
    if (!name) return { ok: false, message: "Who is the booking for?" };
    const found = await findClients(asker.organizationId, name);
    const exact = found.filter((c) => c.exactMatch);
    if (exact.length === 1) {
      leadId = exact[0].clientId;
      clientName = exact[0].name;
    } else if (exact.length > 1) {
      return { ok: false, message: "More than one client has that name. Ask which one.", candidates: exact };
    } else {
      let phone: string | null = null;
      if (req.clientPhone?.trim()) {
        const parsed = normalisePhone(req.clientPhone);
        if (!parsed.ok) return { ok: false, message: `That number does not look right: ${parsed.reason}` };
        phone = parsed.e164;
      }
      newClient = { name, phone };
      clientName = name;
    }
  }

  // What, when, with whom.
  const svc = resolveBookedService(req.service, cfg.services);
  if (!svc.ok) {
    return {
      ok: false,
      message: svc.matched.length
        ? `I have ${svc.matched.map((s) => s.name).join(" and ")}, but not "${svc.unmatched.join('", "')}".`
        : `"${req.service ?? ""}" is not on the service list.`,
      services: cfg.services.map((s) => s.name),
    };
  }
  const service = svc.service;
  const when = resolveWhen(cfg, req.date, req.time);
  if (!when.ok) return when;
  const startsAt = when.at;

  const clientType = leadId && (await hasVisited(leadId)) ? "returning" : "new";
  const needsTest = service.requiresPatchTest && clientType === "new" && !req.skinTestDone;
  if (needsTest) {
    const floor = earliestBookableStart(service, "new", new Date(), 0, undefined, { hours: cfg.hours, timeZone: cfg.timeZone });
    if (startsAt < floor.at) {
      return {
        ok: false,
        message:
          `${clientName} has no visits on record, so ${service.name.toLowerCase()} needs a skin test 48 hours ` +
          `before; the earliest is ${spokenWhen(floor.at, cfg.timeZone)}. If they have had one, say so.`,
      };
    }
  }

  let stylist: Stylist | null;
  if (req.stylist?.trim()) {
    stylist = matchStylist(req.stylist, cfg.stylists);
    if (!stylist) {
      return { ok: false, message: `"${req.stylist}" is not on the team: ${cfg.stylists.map((s) => s.name).join(", ")}.` };
    }
    const why = await slotProblem(asker, cfg, startsAt, service, stylist);
    if (why) return { ok: false, message: why };
  } else if (asker.role === "stylist" && asker.stylist) {
    // A stylist booking for themselves.
    stylist = matchStylist(asker.stylist.name, cfg.stylists);
    if (!stylist) return { ok: false, message: "Your login is not linked to anyone on the team." };
    const why = await slotProblem(asker, cfg, startsAt, service, stylist);
    if (why) return { ok: false, message: why };
  } else {
    const free = await anyFreeStylist(asker, cfg, startsAt, service);
    if ("reason" in free) return { ok: false, message: free.reason };
    stylist = free.stylist;
  }

  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  return {
    ok: true,
    draft: {
      id: randomUUID(),
      kind: "book",
      leadId,
      newClient,
      clientName,
      service: service.name,
      durationMinutes: service.durationMinutes,
      stylist: stylist.name,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      clientType,
      patchTestRequired: service.requiresPatchTest && clientType === "new" && !req.skinTestDone,
      notes: req.notes?.trim() || null,
    },
  };
}

async function hasVisited(leadId: string): Promise<boolean> {
  const n = await prisma.appointment.count({
    where: {
      leadId,
      OR: [{ status: "completed" }, { status: "booked", startsAt: { lt: new Date() } }],
    },
  });
  return n > 0;
}

/** An upcoming booking this person may change, or why not. */
async function changeable(asker: Asker, appointmentId: string | undefined) {
  if (!appointmentId) return { ok: false as const, message: "Which booking? Look the client's bookings up first." };
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, organizationId: asker.organizationId },
    include: { lead: { select: { id: true, name: true, phone: true, email: true } } },
  });
  if (!appt) return { ok: false as const, message: "That booking was not found." };
  if (appt.status !== "booked") return { ok: false as const, message: `That booking is ${appt.status}, so it cannot be changed.` };
  if (!canWriteColumn(asker as TenantContext, appt.stylistName)) {
    return { ok: false as const, message: `That booking is in ${appt.stylistName}'s column, not yours.` };
  }
  return { ok: true as const, appt };
}

export async function proposeMove(
  asker: Asker,
  req: { appointmentId?: string; date?: string; time?: string; stylist?: string }
): Promise<Proposal> {
  const found = await changeable(asker, req.appointmentId);
  if (!found.ok) return found;
  const { appt } = found;
  const cfg = await getSalonConfig(asker.organizationId);
  const svc = resolveBookedService(appt.serviceText, cfg.services);
  const service: SalonService = svc.ok
    ? svc.service
    : { name: appt.serviceText, durationMinutes: appt.durationMinutes, bufferMinutes: 0, requiresPatchTest: false, priceMinor: null };

  // "Move it to half two" keeps the day; "move it to Friday" keeps the time.
  const sameDay = zonedDateString(appt.startsAt, cfg.timeZone);
  const sameTime = spokenClock(appt.startsAt, cfg.timeZone);
  const when = resolveWhen(cfg, req.date, req.time ?? sameTime, sameDay);
  if (!when.ok) return when;

  const stylist = matchStylist(req.stylist ?? appt.stylistName, cfg.stylists);
  if (!stylist) return { ok: false, message: `"${req.stylist}" is not on the team.` };
  const why = await slotProblem(asker, cfg, when.at, { ...service, durationMinutes: appt.durationMinutes }, stylist, appt.id);
  if (why) return { ok: false, message: why };
  if (appt.patchTestRequired) {
    const floor = earliestBookableStart(service, "new", new Date(), 0, undefined, { hours: cfg.hours, timeZone: cfg.timeZone });
    if (when.at < floor.at) {
      return { ok: false, message: `This colour is waiting on a skin test, so it cannot move before ${spokenWhen(floor.at, cfg.timeZone)}.` };
    }
  }

  return {
    ok: true,
    draft: {
      id: randomUUID(),
      kind: "move",
      appointmentId: appt.id,
      clientName: appt.lead.name ?? "Client",
      service: appt.serviceText,
      stylist: stylist.name,
      startsAt: when.at.toISOString(),
      endsAt: new Date(when.at.getTime() + appt.durationMinutes * 60_000).toISOString(),
      durationMinutes: appt.durationMinutes,
      from: { startsAt: appt.startsAt.toISOString(), stylist: appt.stylistName },
    },
  };
}

export async function proposeCancel(asker: Asker, req: { appointmentId?: string }): Promise<Proposal> {
  const found = await changeable(asker, req.appointmentId);
  if (!found.ok) return found;
  const { appt } = found;
  return {
    ok: true,
    draft: {
      id: randomUUID(),
      kind: "cancel",
      appointmentId: appt.id,
      clientName: appt.lead.name ?? "Client",
      service: appt.serviceText,
      stylist: appt.stylistName,
      startsAt: appt.startsAt.toISOString(),
      endsAt: appt.endsAt.toISOString(),
    },
  };
}

// --- Saving --------------------------------------------------------------------------------

export type Committed =
  | { ok: true; kind: Draft["kind"]; appointmentId: string; startsAt: string; stylist: string }
  | { ok: false; message: string };

/**
 * Put a confirmed draft in the diary. The slot is checked again inside the
 * diary's own lock: the draft may be a minute old, and someone at the desk
 * may have taken the time since.
 */
export async function commitDraft(asker: Asker, draft: Draft): Promise<Committed> {
  const provider = await getBookingProvider(asker.organizationId);
  if (!canCreateBooking(provider)) return { ok: false, message: "This diary is not set up to take bookings yet." };
  if (!canWriteColumn(asker as TenantContext, draft.stylist)) {
    return { ok: false, message: `That is ${draft.stylist}'s column, not yours.` };
  }

  if (draft.kind === "book") {
    let lead;
    if (draft.leadId) {
      lead = await prisma.lead.findFirst({ where: { id: draft.leadId, organizationId: asker.organizationId } });
      if (!lead) return { ok: false, message: "That client is no longer on the books." };
    } else if (draft.newClient?.phone) {
      lead = (await clientForBooking(asker.organizationId, draft.newClient.phone, draft.newClient.name, "manual")).lead;
    } else {
      lead = await prisma.lead.create({
        data: { organizationId: asker.organizationId, name: draft.newClient?.name ?? draft.clientName, source: "manual" },
      });
    }
    const booked = await bookAppointment(
      provider,
      {
        organizationId: asker.organizationId,
        startsAt: draft.startsAt,
        durationMinutes: draft.durationMinutes,
        serviceName: draft.service,
        stylistName: draft.stylist,
        clientName: lead.name || draft.clientName,
        clientPhone: lead.phone ?? "",
        clientEmail: lead.email,
        notes: draft.notes ?? undefined,
        leadId: lead.id,
        allowOverlap: false,
      },
      {
        organizationId: asker.organizationId,
        leadId: lead.id,
        serviceText: draft.service,
        durationMinutes: draft.durationMinutes,
        stylistName: draft.stylist,
        clientType: draft.clientType,
        patchTestRequired: draft.patchTestRequired,
        notes: draft.notes,
        source: "voice",
      }
    );
    if (!booked.ok) return { ok: false, message: `Not booked: ${booked.reason}` };
    return { ok: true, kind: "book", appointmentId: booked.appointment.id, startsAt: draft.startsAt, stylist: draft.stylist };
  }

  const found = await changeable(asker, draft.appointmentId);
  if (!found.ok) return found;
  const { appt } = found;

  if (draft.kind === "move") {
    const moved = await moveAppointment(provider, appt, {
      startsAt: new Date(draft.startsAt),
      durationMinutes: draft.durationMinutes,
      stylistName: draft.stylist,
      serviceName: appt.serviceText,
      allowOverlap: false,
    });
    if (!moved.ok) return { ok: false, message: `Not moved: ${moved.reason}` };
    return { ok: true, kind: "move", appointmentId: appt.id, startsAt: draft.startsAt, stylist: draft.stylist };
  }

  // Cancel: off the stylist's calendar too, as the phone does, or the slot
  // stays blocked.
  if (appt.googleEventId && provider.cancelBooking) {
    try {
      await provider.cancelBooking(asker.organizationId, appt.googleEventId, appt.googleCalendarId ?? undefined);
    } catch (err) {
      console.error("[VOICE BOOKING] Calendar cancellation failed:", err);
    }
  }
  await prisma.appointment.update({ where: { id: appt.id }, data: { status: "cancelled" } });
  return { ok: true, kind: "cancel", appointmentId: appt.id, startsAt: draft.startsAt, stylist: draft.stylist };
}

// --- Words ---------------------------------------------------------------------------------

function spokenClock(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function spokenTime(at: Date, timeZone: string): string {
  return at.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).replace(":00", "").replace(" ", "");
}

export function spokenWhen(at: Date, timeZone: string): string {
  const day = at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });
  return `${day} at ${spokenTime(at, timeZone)}`;
}
