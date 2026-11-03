/**
 * The salon's booking rules, as both the phone receptionist and the diary's
 * assistant apply them. Kept in one place so the two cannot drift: a rule
 * fixed here is fixed for callers and for staff.
 *
 * Where the two differ, they differ on purpose, and it is a setting here:
 *
 * - A caller is booked only into a time the diary would offer
 *   (`offeredOnly`); staff may book any free time within working hours
 *   (`staffSlotProblem`), as the desk does.
 * - The words differ: the phone's tell the receptionist what to say next,
 *   staff are told plainly.
 */

import { prisma } from "@/lib/prisma";
import { findBlockClash, findClash } from "@/lib/booking/diary";
import { canReadAvailability, type BookingProvider } from "@/lib/booking/types";
import type { SalonConfig } from "@/lib/booking";
import { hoursForWeekday, zonedDateString, zonedParts } from "@/lib/business-hours";
import { findClientOnNumber, hasBeenBefore, hasVisited } from "@/lib/client-link";
import { matchStylist, stylistDoesService, stylistsForService, type SalonService, type Stylist } from "@/lib/salon-config";

export type ClientType = "new" | "returning" | "unknown";

const DAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Refuse a stylist who does not do the service, and say who does.
 *
 * Returning "nothing free" would be true and useless — the caller would try
 * another day and get the same answer. Naming the right person is what a
 * receptionist does, and it is the difference between the agent sounding
 * knowledgeable and sounding broken.
 *
 * Returns null when the pairing is fine.
 */
export function stylistServiceProblem(
  stylistName: string | undefined,
  service: SalonService,
  stylists: Stylist[]
): string | null {
  if (!stylistName) return null;
  const requested = matchStylist(stylistName, stylists);
  if (!requested) return null; // unrecognised names are handled separately
  if (stylistDoesService(requested, service)) return null;

  const who = stylistsForService(service, stylists).map((s) => s.name);
  const alternative =
    who.length === 0
      ? "Nobody here is set up for it at the moment — take a message."
      : who.length === 1
        ? `${who[0]} does.`
        : `${who.slice(0, -1).join(", ")} and ${who.at(-1)} do.`;

  return (
    `${requested.name} does not do ${service.name.toLowerCase()}. ` +
    `${alternative} Offer that, or ask whether they wanted a different service.`
  );
}

/**
 * Why a booking cannot go at `startsAt`, or null when it can, in the
 * phone's words.
 *
 * The diary write checks clashes and blocked time but not opening hours, on
 * purpose: the desk may book whatever it likes. The phone may not. Without
 * this, a stylist named and a time sent straight to book_appointment (no
 * check_availability first) put a cut in at 3am, and one running past
 * closing. So: the salon open that day, the whole service inside its hours,
 * the stylist in that day; and for a new booking by phone, a time the diary
 * would actually offer, which also covers the stylist's own blocks and
 * bookings.
 */
export async function slotProblem(
  provider: BookingProvider,
  organizationId: string,
  cfg: SalonConfig,
  startsAt: Date,
  service: SalonService,
  stylist: Stylist,
  opts: { clientType?: ClientType; offeredOnly: boolean }
): Promise<string | null> {
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  const start = zonedParts(startsAt, cfg.timeZone);
  const end = zonedParts(endsAt, cfg.timeZone);
  const dayName = DAY_NAMES_LONG[start.weekday];
  const hours = hoursForWeekday(cfg.hours, start.weekday);
  if (!hours || hours.closed) {
    return `The salon is closed on ${dayName}s. Offer another day.`;
  }
  const hhmm = (p: { hour: number; minute: number }) =>
    `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const sameDay = zonedDateString(startsAt, cfg.timeZone) === zonedDateString(endsAt, cfg.timeZone);
  if (hhmm(start) < hours.open || !sameDay || hhmm(end) > hours.close) {
    return (
      `That is outside opening hours: on ${dayName}s the salon is open ` +
      `${hours.open} to ${hours.close}, and ${service.name.toLowerCase()} takes ` +
      `${service.durationMinutes} minutes. Offer a time that fits.`
    );
  }
  if (stylist.workingDays.length > 0 && !stylist.workingDays.includes(start.weekday)) {
    return `${stylist.name} does not work on ${dayName}s. Offer another day, or someone else.`;
  }
  if (opts.offeredOnly && canReadAvailability(provider)) {
    try {
      const slots = await provider.getAvailability({
        organizationId,
        date: zonedDateString(startsAt, cfg.timeZone),
        serviceName: service.name,
        stylistName: stylist.name,
        clientType: opts.clientType,
      });
      const iso = startsAt.toISOString();
      if (!slots.some((sl) => sl.start === iso)) {
        return (
          `${stylist.name} cannot take that time: it is booked, blocked, or ` +
          "not a time the diary offers. Call check_availability for that day " +
          "and offer one of the times it gives."
        );
      }
    } catch (err) {
      // The write itself still refuses a clash; hours were checked above.
      console.warn("[BOOKING RULES] Slot check failed:", err);
    }
  }
  return null;
}

/** A booking a minute or two in the past is someone writing it up late, not a mistake. */
const PAST_GRACE_MS = 15 * 60_000;

/**
 * Why staff cannot book `service` at `startsAt` with `stylist`, or null.
 *
 * Any free time within working hours: not only the times the diary would
 * offer a caller. So: not already gone, the stylist does the service, the
 * salon open and the stylist in (slotProblem, without its offered-times
 * rule), and nobody else booked or blocked out then. Said plainly, for staff.
 */
export async function staffSlotProblem(
  provider: BookingProvider,
  organizationId: string,
  cfg: SalonConfig,
  startsAt: Date,
  service: SalonService,
  stylist: Stylist,
  excludeAppointmentId?: string
): Promise<string | null> {
  if (startsAt.getTime() < Date.now() - PAST_GRACE_MS) return "That time has already gone.";
  const pairing = stylistServiceProblem(stylist.name, service, cfg.stylists);
  if (pairing) return pairing.replace(/ Offer that, or ask whether they wanted a different service\.$/, "");
  const hours = await slotProblem(provider, organizationId, cfg, startsAt, service, stylist, { offeredOnly: false });
  if (hours) return hours.replace(/ (Offer|Call) .*$/, "");
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
  const clash = await findClash(prisma, organizationId, stylist.name, startsAt, endsAt, excludeAppointmentId);
  if (clash) {
    return `${stylist.name} already has ${clash.serviceText.toLowerCase()} at ${clockTime(clash.startsAt, cfg.timeZone)}.`;
  }
  const block = await findBlockClash(prisma, organizationId, stylist.name, startsAt, endsAt);
  if (block) return block.stylistName === null ? "The salon is closed then." : `${stylist.name} is not available then.`;
  return null;
}

function clockTime(at: Date, timeZone: string): string {
  return at
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .replace(":00", "")
    .replace(" ", "");
}

/**
 * New or returning, a patch test on the salon's records, and whether a
 * colour still needs a skin test: what both a phone booking and a staff one
 * decide before anything else.
 *
 * Who it is for, as each side knows them: a caller by the number and the
 * name the booking is for (so a mum's visits or test never count for her
 * daughter on the same phone); staff by the client's record, or none for
 * someone new.
 *
 * - Returning when said, or when their record has a visit on it.
 * - With nothing said and no record, "unknown" for a caller (they are asked,
 *   if it matters) and "new" for staff (no visits on record is new).
 * - A patch test on their record, or staff saying they have had one, means
 *   no new test and no 48-hour wait; `patchType` is the type to apply the
 *   skin-test rule with, while `clientType` stays what the booking records.
 */
export async function colourStatus(
  organizationId: string,
  service: SalonService,
  who: { phone: string; name: string } | { leadId: string | null },
  opts: { said?: ClientType; skinTestDone?: boolean } = {}
): Promise<{ clientType: ClientType; testedOn: Date | null; patchType: ClientType; needsSkinTest: boolean }> {
  let clientType: ClientType;
  let testedOn: Date | null = null;
  if ("phone" in who) {
    clientType = opts.said ?? "unknown";
    if (clientType !== "returning" && (await hasBeenBefore(organizationId, who.phone, who.name))) {
      clientType = "returning";
    }
    if (service.requiresPatchTest) {
      testedOn = (await findClientOnNumber(organizationId, who.phone, who.name))?.patchTestAt ?? null;
    }
  } else {
    clientType = who.leadId && (await hasVisited(who.leadId)) ? "returning" : "new";
    if (who.leadId) {
      testedOn =
        (await prisma.lead.findUnique({ where: { id: who.leadId }, select: { patchTestAt: true } }))?.patchTestAt ?? null;
    }
  }
  const patchType: ClientType = testedOn || opts.skinTestDone ? "returning" : clientType;
  return { clientType, testedOn, patchType, needsSkinTest: service.requiresPatchTest && patchType !== "returning" };
}

/**
 * Whether a booking being moved still waits on a skin test, as the type to
 * apply the skin-test rule with. A booking that needed none when it was made
 * needs none now; one that did, needs it still, unless a patch test has been
 * recorded for the client since.
 */
export async function moveClientType(appt: { patchTestRequired: boolean; leadId: string }): Promise<ClientType> {
  if (!appt.patchTestRequired) return "returning";
  const tested = (await prisma.lead.findUnique({ where: { id: appt.leadId }, select: { patchTestAt: true } }))?.patchTestAt;
  return tested ? "returning" : "new";
}
