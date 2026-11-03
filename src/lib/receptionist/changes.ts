import { prisma } from "@/lib/prisma";
import { moveAppointment } from "@/lib/booking/diary";
import {
  canCreateBooking,
  earliestBookableStart,
  getBookingProvider,
  getSalonConfig,
} from "@/lib/booking";
import { moveClientType, slotProblem } from "@/lib/booking/rules";
import { matchStylist, resolveBookedService } from "@/lib/salon-config";
import { normalisePhone } from "@/lib/phone";
import { normaliseCallerName } from "@/lib/caller-name";
import {
  cancellationBody,
  rescheduleBody,
  sendSms,
  type SmsResult,
} from "@/lib/sms";
import {
  describeAppointmentWhen,
  parseDateOnly,
  parseSpokenTimeOn,
  resolveSpokenDate,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import { namesMatch } from "@/lib/client-name";
import { peopleOnNumber, textRecipient } from "@/lib/client-link";
import { blankToUndefined, type ResolvedPhone } from "./action-helpers";

/**
 * Finding, cancelling and moving an existing appointment, and the identity
 * checks that decide whether this caller may do so.
 */

// -------------------------------------------------------------------------
// Changing an existing appointment
//
// Cancellations are probably more common on an after-hours line than new
// bookings — someone realising at nine at night that tomorrow will not work.
// Without these the agent has no tool for it and either takes a message or,
// worse, sounds confused.
//
// Identification is by phone number alone. That is deliberate for a salon: it
// is what the client has to hand, and demanding more would lose more real
// cancellations than it prevents mischief. The trade-off is that someone who
// knows a number could cancel that person's appointment; the agent reads the
// details back before acting, which is the same protection a receptionist
// gives.
// -------------------------------------------------------------------------

interface ResolvedAppointment {
  id: string;
  serviceText: string;
  durationMinutes: number;
  stylistName: string;
  startsAt: Date;
  googleEventId: string | null;
  googleCalendarId: string | null;
  patchTestRequired: boolean;
  clientType: string;
  notes: string | null;
  bookingNumber: number | null;
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    /** Set for a client reached through someone else's number. */
    contactLead: { name: string | null; phone: string | null } | null;
  };
}

/** What every booking look-up reads of the client, for names and texts. */
const LEAD_FOR_LOOKUP = {
  select: {
    id: true,
    name: true,
    phone: true,
    contactLead: { select: { name: true, phone: true } },
  },
} as const;

/** Who is on the phone, as far as the line and the caller have said. */
export interface CallerIdentity {
  /** Caller ID, when the number is not withheld. */
  callerNumber?: string;
  /** The name the caller gave for themselves. */
  callerName?: string;
}

/** What a caller can quote to find a booking, beyond who they are. */
export interface BookingLookup extends CallerIdentity {
  customerPhone?: string;
  phone?: string;
  /** From the confirmation text. With bookingName, enough whoever is calling. */
  bookingNumber?: string;
  /** The name the booking is under, as the caller gives it. */
  bookingName?: string;
  appointmentId?: string;
}

/**
 * A booking number as the model sent it: "1043", "booking 1043", "#1043".
 * Null when there is no run of digits a booking number could be.
 */
export function parseBookingNumber(raw: string | undefined): number | null {
  const digits = (blankToUndefined(raw) ?? "").replace(/[\s-]/g, "").match(/\d+/)?.[0];
  if (!digits || digits.length > 9) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

/**
 * Whether a name the caller gave goes with a booking: the client's own, or,
 * for a client reached through someone else's number, that person's (a
 * parent can quote their child's booking under their own name).
 */
function isBookedFor(name: string, appt: Pick<ResolvedAppointment, "lead">): boolean {
  return namesMatch(name, appt.lead.name) || namesMatch(name, appt.lead.contactLead?.name);
}

/**
 * The booking a caller means, and whether they may hear about it.
 *
 * By booking number and the name it is under: together they are the proof,
 * whoever is ringing. The number is on the client's confirmation text, but
 * numbers run in sequence, so on its own one is a guess away from someone
 * else's booking. By phone number: the rules in thirdPartyRefusal apply.
 */
async function findBooking(
  organizationId: string,
  params: BookingLookup,
  timeZone: string
): Promise<
  | { ok: true; appointment: ResolvedAppointment }
  | { ok: false; result: Record<string, unknown> }
> {
  const bookingNumber = parseBookingNumber(params.bookingNumber);
  if (bookingNumber !== null) {
    const appointment = await prisma.appointment.findFirst({
      where: { organizationId, bookingNumber, status: "booked", startsAt: { gte: new Date() } },
      include: { lead: LEAD_FOR_LOOKUP },
    });
    if (!appointment) {
      return {
        ok: false,
        result: {
          found: false,
          message:
            `No upcoming booking has the number ${bookingNumber}. Read it back to ` +
            "check it, or look it up by the phone number it was booked under.",
        },
      };
    }
    // The client's own name will do if that is who is ringing.
    const given = normaliseCallerName(params.bookingName ?? params.callerName);
    if (!given.ok) {
      return {
        ok: false,
        result: {
          found: true,
          needsBookingName: true,
          message:
            "Say nothing about the booking yet. Ask whose name it is booked under, " +
            "then call this again with the booking number and that name as bookingName.",
        },
      };
    }
    if (!isBookedFor(given.name, appointment as ResolvedAppointment)) {
      // Worded like a miss on purpose: which of the two was wrong, or whose
      // the booking is, would help someone guessing.
      return {
        ok: false,
        result: {
          found: false,
          nameDidNotMatch: true,
          message:
            `Booking number ${bookingNumber} and the name ${given.name} do not go together. ` +
            "Tell them nothing about any booking. Check both with the caller once; if they " +
            "still do not match, offer to take a message for the salon.",
        },
      };
    }
    return { ok: true, appointment: appointment as ResolvedAppointment };
  }

  const parsed = lookupPhone(params.customerPhone ?? params.phone, params.callerNumber);
  if (!parsed.ok) {
    return {
      ok: false,
      result: { found: false, message: `${parsed.reason} Ask for it again, or for their booking number.` },
    };
  }
  return resolveAppointment(
    organizationId,
    parsed.e164,
    blankToUndefined(params.appointmentId),
    timeZone,
    params
  );
}

/**
 * The number to look a booking up by.
 *
 * Caller ID when no number was said, or when what was sent has no digits in
 * it at all: the model sends "caller_id" or "this number" for "the one I'm
 * ringing from", and refusing that sent a client with a booking under their
 * own number round in circles until the salon had to ring back. A number
 * that was actually said but will not parse is asked for again, not
 * swapped for caller ID: they meant a different number.
 */
export function lookupPhone(given: string | undefined, callerNumber: string | undefined): ResolvedPhone {
  const spoken = blankToUndefined(given);
  if (spoken && /\d/.test(spoken)) {
    const parsed = normalisePhone(spoken);
    return parsed.ok ? { ok: true, e164: parsed.e164, source: "given" } : { ok: false, reason: parsed.reason };
  }
  const fromCaller = normalisePhone(blankToUndefined(callerNumber));
  if (fromCaller.ok) return { ok: true, e164: fromCaller.e164, source: "callerId" };
  return { ok: false, reason: "No number was given, and their caller ID is withheld." };
}

function isOwnNumber(phone: string, callerNumber: string | undefined): boolean {
  const own = normalisePhone(blankToUndefined(callerNumber));
  return own.ok && own.e164 === phone;
}

/**
 * Why a booking may not be discussed with this caller, or null when it may.
 *
 * A booking belongs to the person it is for. Someone ringing from the number
 * it is under is taken to be them (or the person who made it, such as a parent
 * who booked on their own phone). Anyone else has to be the client by name.
 * The booking's name is never told to them: "is that Sarah?" invites "yes".
 */
export function thirdPartyRefusal(
  phone: string,
  who: CallerIdentity,
  /** Everyone on the number: its own client, and any reached through it. */
  bookedNames: string | null | Array<string | null>
): Record<string, unknown> | null {
  if (isOwnNumber(phone, who.callerNumber)) return null;
  const names = (Array.isArray(bookedNames) ? bookedNames : [bookedNames]).filter((n): n is string =>
    Boolean(n?.trim())
  );
  if (names.length === 0) return null;

  // "yourself" and the like are the model filling a field, not a name.
  const given = normaliseCallerName(who.callerName);
  const callerName = given.ok ? given.name : undefined;
  if (!callerName) {
    return {
      found: true,
      needsCallerName: true,
      message:
        "There is a booking on that number, but it is not the number they are " +
        "ringing from. Say nothing more about it yet: ask for their own name, " +
        "then call this again with it as callerName. If they have the booking " +
        "number from the confirmation text and the name it is under, those are " +
        "enough instead: call this again with bookingNumber and bookingName.",
    };
  }
  if (names.some((n) => namesMatch(callerName, n))) return null;
  return {
    found: true,
    notTheirs: true,
    message:
      `That booking is not in the name of ${callerName}, the person on the phone. ` +
      "Ask whether they have its booking number, from the confirmation text, and the " +
      "name it is under: if they do, call this again with bookingNumber and bookingName " +
      "and you may go ahead. Without them, do not " +
      "tell them anything about the booking, not the day, time, service or stylist, " +
      "and do not cancel or move it. Say you can only discuss it with the person it " +
      "is for, and offer to take a message so the salon can contact them. " +
      "A message is save_customer_details with the caller's own name and number, " +
      "and who it is for and what they want in `issue`.",
  };
}

/**
 * Find the appointment a caller means.
 *
 * Returns the single upcoming one where that is unambiguous, so the common
 * case needs no lookup call first. Where there are several, it refuses and
 * lists them rather than guessing — cancelling the wrong appointment is not
 * recoverable by the person on the phone.
 */
async function resolveAppointment(
  organizationId: string,
  phone: string,
  appointmentId: string | undefined,
  timeZone: string,
  who: CallerIdentity
): Promise<
  | { ok: true; appointment: ResolvedAppointment }
  | { ok: false; result: Record<string, unknown> }
> {
  // The number's own client, and anyone reached through it (a child booked
  // on a parent's phone): one call from it manages all of their bookings.
  const people = await peopleOnNumber(organizationId, phone);

  if (people.length === 0) {
    return {
      ok: false,
      result: {
        found: false,
        message:
          "Nothing on that number. Check it with the caller, or they may " +
          "have booked under a different one.",
      },
    };
  }

  const all = await prisma.appointment.findMany({
    where: {
      organizationId,
      leadId: { in: people.map((p) => p.id) },
      status: "booked",
      startsAt: { gte: new Date() },
    },
    include: { lead: LEAD_FOR_LOOKUP },
    orderBy: { startsAt: "asc" },
  });

  if (all.length === 0) {
    return {
      ok: false,
      result: {
        found: false,
        message:
          "No upcoming appointments on that number. Anything in the past " +
          "cannot be changed from here.",
      },
    };
  }

  // Before anything about the booking is handed over, not after: a model
  // given the details alongside an instruction not to read them out read
  // them out, then cancelled the booking for the friend who asked.
  const refusal = thirdPartyRefusal(phone, who, people.map((p) => p.name));
  if (refusal) return { ok: false, result: refusal };

  // From another phone, a client reached through this number sees their own
  // bookings; the number's own client, like a call from the number itself,
  // sees everyone's.
  const given = normaliseCallerName(who.callerName);
  const holder = people.find((p) => p.isHolder);
  const upcoming =
    isOwnNumber(phone, who.callerNumber) || !given.ok || namesMatch(given.name, holder?.name)
      ? all
      : all.filter((a) => namesMatch(given.name, a.lead.name));
  if (upcoming.length === 0) {
    return { ok: false, result: { found: false, message: "No upcoming appointments for them on that number." } };
  }

  if (appointmentId) {
    const match = upcoming.find((a) => a.id === appointmentId);
    if (!match) {
      return {
        ok: false,
        result: {
          found: false,
          message: "That appointment reference did not match. Look it up again.",
        },
      };
    }
    return { ok: true, appointment: match as ResolvedAppointment };
  }

  if (upcoming.length === 1) {
    return { ok: true, appointment: upcoming[0] as ResolvedAppointment };
  }

  return {
    ok: false,
    result: {
      found: true,
      ambiguous: true,
      appointments: upcoming.map((a) => ({
        appointmentId: a.id,
        for: a.lead.name,
        when: describeAppointmentWhen(a.startsAt, timeZone),
        service: a.serviceText,
        stylist: a.stylistName,
      })),
      message:
        "There is more than one booked. Read them out, saying whose each is if " +
        "they are not all for the same person, ask which they mean, then call " +
        "again with that appointmentId.",
    },
  };
}

/**
 * Text the client about their own booking, at their number, or the number
 * they are reached through (greeting its owner). Not the caller's: when a
 * friend quotes the booking number and cancels, the client is the one who
 * needs to hear about it.
 */
async function textClient(
  organizationId: string,
  appt: ResolvedAppointment,
  body: (to: { clientName: string | null; forName: string | null }) => string
): Promise<SmsResult> {
  const to = textRecipient(appt.lead);
  if (!to) return { ok: false, configured: true, reason: "No number on the booking." };
  return sendSms(organizationId, to.to, body({ clientName: to.greet, forName: to.forName }));
}

async function orgMessageContext(organizationId: string) {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { businessName: true, contactPhone: true },
  });
  return {
    businessName: settings?.businessName ?? "the salon",
    contactPhone: settings?.contactPhone ?? null,
  };
}

export async function handleFindAppointment(
  organizationId: string,
  params: Omit<BookingLookup, "appointmentId">
) {
  const cfg = await getSalonConfig(organizationId);
  const resolved = await findBooking(organizationId, params, cfg.timeZone);

  if (!resolved.ok) return resolved.result;

  const a = resolved.appointment;
  return {
    found: true,
    appointmentId: a.id,
    bookingNumber: a.bookingNumber,
    when: describeAppointmentWhen(a.startsAt, cfg.timeZone),
    service: a.serviceText,
    stylist: a.stylistName,
    clientName: a.lead.name,
    // Whose it is, by name: a daughter who rang about the booking her mum
    // made on her phone was told it was "your mum's" when it was her own.
    message:
      `${a.lead.name ?? "The client"} has ${a.serviceText.toLowerCase()} with ${a.stylistName} ` +
      `${describeAppointmentWhen(a.startsAt, cfg.timeZone)}. Read that back, ` +
      "saying whose it is, and confirm it is the one they mean before changing anything.",
  };
}

export async function handleCancelAppointment(
  organizationId: string,
  params: BookingLookup & { reason?: string }
) {
  const cfg = await getSalonConfig(organizationId);
  const resolved = await findBooking(organizationId, params, cfg.timeZone);
  if (!resolved.ok) return { success: false, ...resolved.result };

  const appt = resolved.appointment;
  const whenText = describeAppointmentWhen(appt.startsAt, cfg.timeZone);

  // Remove it from the stylist's calendar, not just our record. A cancelled
  // appointment that still blocks the diary is the same as no cancellation —
  // the slot cannot be resold, which is the entire point of ringing in.
  const provider = await getBookingProvider(organizationId);
  let calendarCleared = true;
  if (appt.googleEventId && provider.cancelBooking) {
    try {
      await provider.cancelBooking(
        organizationId,
        appt.googleEventId,
        appt.googleCalendarId ?? undefined
      );
    } catch (err) {
      calendarCleared = false;
      console.error("[RECEPTIONIST] Calendar cancellation failed:", err);
    }
  }

  const note = blankToUndefined(params.reason);
  await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      status: "cancelled",
      notes: [
        appt.notes,
        `Cancelled by phone${note ? `: ${note}` : ""}${
          calendarCleared ? "" : " — CALENDAR ENTRY NOT REMOVED, do it by hand"
        }`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  });

  const ctx = await orgMessageContext(organizationId);
  const sms = await textClient(organizationId, appt, (to) =>
    cancellationBody({
      ...to,
      serviceName: appt.serviceText,
      stylistName: appt.stylistName,
      whenText,
      ...ctx,
    })
  );

  return {
    success: true,
    cancelled: whenText,
    textSent: sms.ok,
    // Staff need to know when the diary was not actually cleared, because the
    // caller has been told it was.
    calendarCleared,
    message:
      `Cancelled: ${appt.lead.name ? `${appt.lead.name}'s ` : ""}${appt.serviceText} with ${appt.stylistName} ${whenText}. ` +
      "In one sentence, say it is cancelled" +
      (sms.ok ? " and a text is coming" : " (do not promise a text)") +
      `, and ask if they want another time: "That's cancelled${sms.ok ? ", and a text is on its way" : ""}. Would you like to rebook?"`,
  };
}

/** What reschedule_appointment is sent: the booking, and where it goes. */
type MoveParams = BookingLookup & {
  date?: string;
  day?: string;
  time: string;
  stylist?: string;
};

export async function handleRescheduleAppointment(organizationId: string, params: MoveParams) {
  const checked = await checkMove(organizationId, params);
  if (checked.ok !== true) return checked;
  return writeMove(organizationId, checked.move);
}

/**
 * Every rule a move by phone is held to: a diary that takes changes, the
 * booking found and theirs to change, the new time, the service as it was
 * booked, the skin-test and lead-time floor, the stylist, and opening hours
 * and working days. The refusal for the first that fails, or the move.
 */
async function checkMove(organizationId: string, params: MoveParams) {
  const cfg = await getSalonConfig(organizationId);
  const provider = await getBookingProvider(organizationId);
  if (!canCreateBooking(provider)) {
    return {
      success: false,
      message:
        "You cannot change the diary directly. Take the request and say the " +
        "salon will confirm.",
    };
  }

  const resolved = await findBooking(organizationId, params, cfg.timeZone);
  if (!resolved.ok) return { success: false, ...resolved.result };

  const appt = resolved.appointment;
  const previousWhenText = describeAppointmentWhen(appt.startsAt, cfg.timeZone);

  let startsAt: Date;
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(params.time))) {
    startsAt = new Date(params.time);
  } else {
    const newDate = resolveSpokenDate(params.date || params.day, cfg.timeZone);
    if (!newDate) {
      return {
        success: false,
        message: "Which day did they want to move to? Ask, then call again.",
      };
    }
    const clock = parseSpokenTimeOn(params.time, cfg.hours, newDate);
    const m = clock ? /^(\d{2}):(\d{2})$/.exec(clock) : null;
    if (!m) {
      return { success: false, message: `That time did not parse ("${params.time}").` };
    }
    const d = parseDateOnly(newDate);
    startsAt = zonedWallTimeToUtc(d.year, d.month, d.day, Number(m[1]), Number(m[2]), cfg.timeZone);
  }
  if (Number.isNaN(startsAt.getTime())) {
    return { success: false, message: "That date and time did not parse." };
  }

  // Resolved the same way it was booked, so an appointment covering two
  // services keeps both of them — and its full length — when it moves.
  const originalService = resolveBookedService(appt.serviceText, cfg.services);
  if (!originalService.ok) {
    return {
      success: false,
      message:
        `The original service (${appt.serviceText}) is no longer in the list, ` +
        "so its length is unknown. Take a message for the salon.",
    };
  }
  const service = originalService.service;

  // The lead-time rules apply to the new slot as much as the original. A
  // colour moved inside the patch-test window is the same hazard whether it
  // was booked that way or moved there.
  // A patch test recorded since the booking was made counts too.
  const clientType = await moveClientType({ patchTestRequired: appt.patchTestRequired, leadId: appt.lead.id });
  const floor = earliestBookableStart(service, clientType, new Date(), undefined, undefined, cfg);
  if (startsAt < floor.at) {
    return {
      success: false,
      tooSoon: true,
      patchTestRequired: floor.reason === "patch_test",
      message:
        floor.reason === "patch_test"
          ? `${service.name} needs a patch test 48 hours ahead for a new client, so it cannot move that close. Offer a later slot.`
          : "That is too soon. Offer a later time.",
    };
  }

  const stylistName = blankToUndefined(params.stylist) ?? appt.stylistName;
  const stylist = matchStylist(stylistName, cfg.stylists);
  if (!stylist) {
    return {
      success: false,
      message: `"${stylistName}" is not a stylist here. Confirm who they want.`,
    };
  }

  // Hours and working days only: the diary would count this appointment's
  // own current slot as busy, so "offered times" would refuse a move by
  // half an hour. The move itself still refuses any real clash.
  const slotIssue = await slotProblem(provider, organizationId, cfg, startsAt, service, stylist, {
    offeredOnly: false,
  });
  if (slotIssue) {
    return { success: false, notAvailable: true, message: slotIssue };
  }

  return { ok: true as const, move: { provider, cfg, appt, service, stylist, startsAt, previousWhenText } };
}

type CheckedMove = Extract<Awaited<ReturnType<typeof checkMove>>, { ok: true }>["move"];

/** Move a checked booking, text the client, and say how it went. */
async function writeMove(organizationId: string, m: CheckedMove) {
  const { provider, cfg, appt, service, stylist, startsAt, previousWhenText } = m;
  const refused = (conflict: boolean) => ({
    success: false,
    conflict,
    keptOriginal: true,
    message: conflict
      ? `That time is taken. Their original appointment ${previousWhenText} is untouched — offer another time.`
      : `Could not move it. Their original appointment ${previousWhenText} still stands. Say the salon will ring to sort it.`,
  });

  // The appointment keeps the length it was booked at, which the desk may
  // have set by hand. The phone never overlaps another booking or a block.
  const moved = await moveAppointment(
    provider,
    { ...appt, organizationId },
    {
      startsAt,
      durationMinutes: appt.durationMinutes,
      stylistName: stylist.name,
      serviceName: service.name,
    },
    {
      // A reminder for the old date must not go out for the new one.
      reminderSentAt: null,
      reminderError: null,
      notes: [appt.notes, `Moved from ${previousWhenText} by phone`]
        .filter(Boolean)
        .join("\n"),
    }
  );
  if (!moved.ok) return refused(Boolean(moved.conflict));
  const updated = moved.appointment;
  const oldCleared = moved.oldCleared ?? true;

  const whenText = describeAppointmentWhen(updated.startsAt, cfg.timeZone);
  const ctx = await orgMessageContext(organizationId);
  const sms = await textClient(organizationId, appt, (to) =>
    rescheduleBody({
      ...to,
      serviceName: service.name,
      stylistName: stylist.name,
      whenText,
      previousWhenText,
      bookingNumber: appt.bookingNumber,
      ...ctx,
    })
  );

  await prisma.appointment.update({
    where: { id: appt.id },
    data: sms.ok
      ? { confirmationSentAt: new Date(), confirmationError: null }
      : { confirmationError: sms.reason },
  });

  return {
    success: true,
    movedTo: whenText,
    stylist: stylist.name,
    textSent: sms.ok,
    oldSlotReleased: oldCleared,
    message:
      `Moved${appt.lead.name ? ` ${appt.lead.name}'s booking` : ""} to ${whenText} with ${stylist.name}. In one sentence, ` +
      "say it is moved to the new day and time" +
      (sms.ok ? " and a text is coming" : " (do not promise a text)") +
      ", then ask if there is anything else.",
  };
}
