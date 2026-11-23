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

/** Who is on the phone, as far as the line has said. */
export interface CallerIdentity {
  /** Caller ID (or the WhatsApp number), when there is one: never a number they said. */
  callerNumber?: string;
  /** The name the caller gave for themselves. Kept for messages: it unlocks nothing. */
  callerName?: string;
}

/** What a caller can quote to pick out a booking on their own number. */
export interface BookingLookup extends CallerIdentity {
  customerPhone?: string;
  phone?: string;
  /** From the confirmation text: picks one booking out, on the caller's own number only. */
  bookingNumber?: string;
  /** No longer used to unlock anything: a name proves nothing. */
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
 * Said when a booking may not be discussed: the caller is not on the number
 * it is under, or the channel has no number at all (the website chat,
 * Instagram, Messenger, a withheld caller ID). Worded the same whether or
 * not there is a booking, so it tells a stranger nothing.
 */
export const NOT_FROM_ITS_NUMBER = {
  found: false,
  notFromItsNumber: true,
  message:
    "Bookings can only be looked up, changed or cancelled from the phone number " +
    "they are booked under, and they are not on it (or this chat has no number). " +
    "Tell them nothing about any booking, not even whether there is one, and do " +
    "not cancel or move anything. Say the salon will get back to them, and take a " +
    "message: take_message with their own name, a number to reach them, and what " +
    "they want, so the salon can contact the client.",
} as const;

/** The caller's own number, from the line or WhatsApp: never one they said. */
function verifiedNumber(who: CallerIdentity): string | null {
  const own = normalisePhone(blankToUndefined(who.callerNumber));
  return own.ok ? own.e164 : null;
}

/** The numbers a booking is under: the client's, or the one they are reached through. */
function numbersOf(appt: Pick<ResolvedAppointment, "lead">): string[] {
  return [appt.lead.phone, appt.lead.contactLead?.phone].filter((n): n is string => Boolean(n));
}

/**
 * The booking a caller means, and whether they may hear about it.
 *
 * Only from the number it is under. That number comes from the phone line or
 * WhatsApp, so it cannot be made up by typing. A name proves nothing (it was
 * enough, and anyone who knew a client's number and first name could hear and
 * cancel her booking), and booking numbers run in sequence, so they are a guess
 * away from someone else's. A booking number still picks one booking out on
 * the caller's own number.
 */
async function findBooking(
  organizationId: string,
  params: BookingLookup,
  timeZone: string
): Promise<
  | { ok: true; appointment: ResolvedAppointment }
  | { ok: false; result: Record<string, unknown> }
> {
  const own = verifiedNumber(params);
  if (!own) return { ok: false, result: { ...NOT_FROM_ITS_NUMBER } };

  const bookingNumber = parseBookingNumber(params.bookingNumber);
  if (bookingNumber !== null) {
    const appointment = await prisma.appointment.findFirst({
      where: { organizationId, bookingNumber, status: "booked", startsAt: { gte: new Date() } },
      include: { lead: LEAD_FOR_LOOKUP },
    });
    if (!appointment || !numbersOf(appointment as ResolvedAppointment).includes(own)) {
      return {
        ok: false,
        result: {
          found: false,
          message:
            `Nothing booked as ${bookingNumber} on the number they are on. Look it up by ` +
            "their number instead; if it is under a different number, it can only be " +
            "changed from that one: take a message for the salon.",
        },
      };
    }
    return { ok: true, appointment: appointment as ResolvedAppointment };
  }

  const parsed = lookupPhone(params.customerPhone ?? params.phone, own);
  if (!parsed.ok) {
    return { ok: false, result: { found: false, message: `${parsed.reason} Ask for it again.` } };
  }
  if (parsed.e164 !== own) return { ok: false, result: { ...NOT_FROM_ITS_NUMBER } };
  return resolveAppointment(organizationId, parsed.e164, blankToUndefined(params.appointmentId), timeZone);
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
  timeZone: string
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

  // Called only from the number itself (findBooking): it manages everyone
  // booked through it.
  const upcoming = all;

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
