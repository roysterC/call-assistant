import { prisma } from "@/lib/prisma";
import { bookAppointment } from "@/lib/booking/diary";
import {
  canCreateBooking,
  canReadAvailability,
  earliestBookableStart,
  getBookingProvider,
  getSalonConfig,
  type SalonConfig,
} from "@/lib/booking";
import type { WritableProvider } from "@/lib/booking/types";
import { colourStatus, slotProblem, stylistServiceProblem } from "@/lib/booking/rules";
import {
  matchStylist,
  resolveBookedService,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";
import { speakablePhone } from "@/lib/phone";
import { nameRequiredMessage, normaliseCallerName } from "@/lib/caller-name";
import { confirmationBody, sendSms } from "@/lib/sms";
import {
  describeAppointmentWhen,
  parseDateOnly,
  parseSpokenTime,
  resolveSpokenDate,
  zonedDateString,
  zonedIsoString,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import { namesMatch, splitName } from "@/lib/client-name";
import { noticeNewBooking } from "@/lib/booking-notices";
import { clientForBooking } from "@/lib/client-link";
import { spokenPatchTest } from "@/lib/patch-test";
import {
  blankToUndefined,
  normaliseClientType,
  resolveCallerPhone,
  serviceNotResolvedMessage,
  spokenDay,
  spokenTime,
  validEmail,
} from "./action-helpers";

/**
 * Booking a new appointment, and saving a caller's details.
 *
 * book_appointment is checked first (checkBooking) and then either read back
 * to the caller (a dry run, for prepare_booking) or written to the diary and
 * texted (writeBooking). Nothing is written until the checks have passed.
 */

export async function handleSaveCustomerDetails(
  organizationId: string,
  params: {
    name?: string;
    email?: string;
    phone?: string;
    /** Caller ID, filled in by the line. */
    callerNumber?: string;
    company?: string;
    businessType?: string;
    issue?: string;
  }
) {
  const { name, email, phone, company, businessType, issue } = params;

  // Unlike the booking tools this one is deliberately allowed to save what it
  // has — it is called early, before the name may be known. But a filler is
  // worse than nothing: it looks like a captured name in the CRM and stops
  // anyone noticing the gap. So an unusable one is dropped, not refused.
  const parsedName = normaliseCallerName(name);
  const cleanName = parsedName.ok ? parsedName.name : undefined;
  const cleanEmail = validEmail(email);
  const cleanIssue = blankToUndefined(issue);
  const cleanCompany = blankToUndefined(company);
  const noteIssue = blankToUndefined(businessType)
    ? `[${blankToUndefined(businessType)}] ${cleanIssue ?? ""}`.trim()
    : cleanIssue;

  const resolved = resolveCallerPhone(phone, params.callerNumber);

  // A bad number used to throw the whole call away with it. The name and what
  // they were ringing about are worth keeping even when the digits were
  // mis-heard — the salon can still work out who it was, and the number
  // usually arrives correctly later when the booking is made.
  if (!resolved.ok) {
    if (!cleanEmail) {
      return {
        success: false,
        savedAnything: false,
        message:
          `${resolved.reason} Read the number back digit by digit and call ` +
          "this again — nothing could be saved without it.",
      };
    }

    // Email is the other identity key, so a lead can still be keyed on it.
    const lead = await prisma.lead.upsert({
      where: { organizationId_email: { organizationId, email: cleanEmail } },
      update: {
        ...(cleanName && { name: cleanName }),
        ...(cleanCompany && { company: cleanCompany }),
        ...(noteIssue && { issue: noteIssue }),
      },
      create: {
        organizationId,
        email: cleanEmail,
        name: cleanName ?? null,
        company: cleanCompany ?? null,
        issue: noteIssue ?? null,
        source: "phone",
      },
    });

    return {
      success: true,
      savedAnything: true,
      phoneMissing: true,
      leadId: lead.id,
      message:
        `Saved against their email. ${resolved.reason} Read the number back ` +
        "digit by digit and call this again so we can ring them.",
    };
  }

  const normalisedPhone = resolved.e164;

  // A message left on someone else's number (a friend ringing about a
  // client) must not rename the client's record to the friend. Same rule as
  // booking: a different person's name goes on the note instead.
  const existing = cleanName
    ? await prisma.lead.findUnique({
        where: { organizationId_phone: { organizationId, phone: normalisedPhone } },
        select: { name: true },
      })
    : null;
  const someoneElse = Boolean(existing?.name) && !namesMatch(existing?.name, cleanName);
  const issueText = someoneElse && noteIssue ? `From ${cleanName}: ${noteIssue}` : noteIssue;

  const lead = await prisma.lead.upsert({
    where: { organizationId_phone: { organizationId, phone: normalisedPhone } },
    update: {
      ...(cleanName && !someoneElse && { name: cleanName }),
      ...(cleanEmail && { email: cleanEmail }),
      ...(cleanCompany && { company: cleanCompany }),
      ...(issueText && { issue: issueText }),
    },
    create: {
      organizationId,
      phone: normalisedPhone,
      name: cleanName ?? null,
      email: cleanEmail ?? null,
      company: cleanCompany ?? null,
      issue: noteIssue ?? null,
      source: "phone",
    },
  });

  return {
    success: true,
    savedAnything: true,
    phone: normalisedPhone,
    usedCallerId: resolved.source === "callerId",
    leadId: lead.id,
    message:
      (someoneElse
        ? `That number is ${lead.name}'s, not ${cleanName}'s: saved as a message from ${cleanName} on it. ` +
          "It has not changed any booking."
        : `Saved for ${lead.name || speakablePhone(normalisedPhone)}.`) +
      (resolved.source === "callerId"
        ? ` The number they spoke could not be used, so the one they are ` +
          `ringing from was taken instead: ${speakablePhone(normalisedPhone)}. ` +
          `Read that back and check it is the right one to reach them on.`
        : ""),
  };
}

/** What book_appointment is sent. */
type BookingParams = {
    date?: string;
    day?: string;
    time: string;
    service: string;
    stylist?: string;
    customerPhone: string;
    /** Caller ID, filled in by the line. */
    callerNumber?: string;
    customerName?: string;
    clientType?: string;
    newClient?: boolean;
    notes?: string;
  };

/** A booking that has passed every rule, with all that writing it needs. */
interface CheckedBooking {
  provider: WritableProvider;
  cfg: SalonConfig;
  service: SalonService;
  stylist: Stylist;
  startsAt: Date;
  clientName: string;
  /** E.164: the number the booking goes on, and its text to. */
  phone: string;
  usedCallerId: boolean;
  /** As said or found on their record: what the booking records. */
  clientType: "new" | "returning" | "unknown";
  needsSkinTest: boolean;
  /** A patch test on the salon's records, as said ("1 September 2026"). */
  onFile: string | null;
  notes?: string;
  today: string;
}

export async function handleBookAppointment(
  organizationId: string,
  params: BookingParams,
  /**
   * Check only: every rule a booking is held to, and nothing written. Gives
   * back exactly what would be booked, for the receptionist to read back
   * before it is (src/lib/receptionist/read-back.ts).
   */
  opts: { dryRun?: boolean } = {}
) {
  const checked = await checkBooking(organizationId, params);
  if (checked.ok !== true) return checked;
  return opts.dryRun ? readBackDetails(checked.booking) : writeBooking(organizationId, checked.booking);
}

/**
 * Every rule a phone booking is held to, in order: a number, a name, a diary
 * that takes bookings, the service, the stylist, the time, new or returning
 * (from what was said, their record, or a patch test on file), the skin-test
 * and lead-time floor, who owns an unnamed slot, the stylist doing the
 * service, and the slot being one the diary offers. The refusal for the first
 * that fails, or the booking ready to write.
 */
async function checkBooking(organizationId: string, params: BookingParams) {
  const { time, customerPhone, customerName, notes } = params;

  const resolvedPhone = resolveCallerPhone(customerPhone, params.callerNumber);
  if (!resolvedPhone.ok) {
    return {
      success: false,
      badPhone: true,
      message: `${resolvedPhone.reason} Read it back digit by digit, confirm it, then book.`,
    };
  }
  const phone = resolvedPhone.e164;

  // Checked before any diary work, because there is no point holding a slot
  // for someone we cannot name. A transcription miss used to arrive here as
  // `undefined` and be written to the lead as `null`, which is how an
  // appointment reached the diary with nobody against it — and why the agent
  // thanked a caller for a name it had never heard.
  const resolvedName = normaliseCallerName(customerName);
  if (!resolvedName.ok) {
    return {
      success: false,
      missingName: true,
      message: nameRequiredMessage(resolvedName.reason),
    };
  }
  const clientName = resolvedName.name;

  const provider = await getBookingProvider(organizationId);
  if (!canCreateBooking(provider)) {
    return {
      success: false,
      message:
        "You cannot book directly. Take the request and tell the caller the " +
        "salon will confirm when they open.",
    };
  }

  const cfg = await getSalonConfig(organizationId);
  const bookedService = resolveBookedService(params.service, cfg.services);
  if (!bookedService.ok) {
    return {
      success: false,
      message: serviceNotResolvedMessage(
        params.service,
        bookedService.matched,
        bookedService.unmatched,
        cfg.services
      ),
    };
  }
  // One appointment covering everything they asked for: its length is the sum
  // of the parts, and it carries the patch-test rule of any colour in it.
  const service = bookedService.service;

  const requestedStylist = blankToUndefined(params.stylist);
  let stylist = matchStylist(requestedStylist, cfg.stylists);

  if (!stylist && requestedStylist) {
    // A name was given and not recognised — say so, rather than implying none
    // was supplied. Usually the transcriber mangling it ("Joe" for "Jo").
    return {
      success: false,
      message:
        `"${requestedStylist}" is not a stylist here. Confirm the name with ` +
        "the caller, or say who you offered the slot with.",
    };
  }

  // `time` is either the ISO startsAt handed back by check_availability, or a
  // plain "HH:MM" on `date`. Prefer the ISO form — it is unambiguous, and it
  // is what the tool result told the model to send back.
  let startsAt: Date;
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(time))) {
    startsAt = new Date(time);
  } else {
    // "14:00", or however it was said: "2pm", "half two", "quarter to four".
    const clock = parseSpokenTime(time);
    const m = clock ? /^(\d{2}):(\d{2})$/.exec(clock) : null;
    if (!m) {
      return {
        success: false,
        message: `That time did not parse ("${time}"). Ask for it again.`,
      };
    }
    const resolved = resolveSpokenDate(params.date || params.day, cfg.timeZone);
    if (!resolved) {
      return {
        success: false,
        message: "Which day did they mean? Ask for a specific day or date.",
      };
    }
    const d = parseDateOnly(resolved);
    startsAt = zonedWallTimeToUtc(
      d.year,
      d.month,
      d.day,
      Number(m[1]),
      Number(m[2]),
      cfg.timeZone
    );
  }

  if (Number.isNaN(startsAt.getTime())) {
    return { success: false, message: "That date and time did not parse." };
  }

  // New or returning (from what was said, or their own record found by name
  // and number), and a patch test on the salon's records for whoever this is
  // for: colour then needs no new test and no 48-hour wait, and there is
  // nothing to ask. patchType is for the skin-test rules only; the booking
  // still records clientType.
  const colour = await colourStatus(
    organizationId,
    service,
    { phone, name: clientName },
    {
      said: normaliseClientType(
        params.clientType ?? (params.newClient === true ? "new" : params.newClient === false ? "returning" : undefined)
      ),
    }
  );
  const { clientType, patchType } = colour;
  const onFile = colour.testedOn ? spokenPatchTest(colour.testedOn) : null;

  // The rule the prompt states, enforced: colour needs to know. Treating
  // "unknown" as new is safe for the diary, but a regular who had colour
  // here last month was booked as new and told she needed a skin test.
  if (service.requiresPatchTest && patchType === "unknown") {
    return {
      success: false,
      needsClientType: true,
      message:
        `${service.name} is a colour service and there is no visit or patch test on record for ` +
        `${clientName} on this number. Ask whether they have had colour here before, then book ` +
        "again with clientType 'returning' if they have, or 'new' if not.",
    };
  }

  const today = zonedDateString(new Date(), cfg.timeZone);

  // Re-apply the lead-time rules here as well as in availability. The model
  // can reach book_appointment without ever calling check_availability, and a
  // patch-test window is not something to enforce only on the happy path.
  // Before the stylist is worked out, so a new client's colour is told about
  // the skin test rather than that nobody is free.
  const floor = earliestBookableStart(service, patchType, new Date(), undefined, undefined, cfg);
  if (startsAt < floor.at) {
    return {
      success: false,
      today,
      tooSoon: true,
      patchTestRequired: floor.reason === "patch_test",
      message:
        floor.reason === "patch_test"
          ? `${service.name} needs a skin patch test at least 48 hours beforehand for a new client. Explain that and offer a later date.`
          : "That is too soon. Offer a later time.",
    };
  }

  // No stylist named: work out who owns the slot that was offered.
  if (!stylist && canReadAvailability(provider)) {
    const iso = startsAt.toISOString();
    let names: string[] | null = null;
    try {
      const slots = await provider.getAvailability({
        organizationId,
        // The day the slot is on, whichever way it was given: an exact
        // time from check_availability arrives with no separate date.
        date: zonedDateString(startsAt, cfg.timeZone),
        serviceName: service.name,
        // As check_availability offered it: a returning client's colour, or
        // one with a patch test on record, has no 48-hour wait. Left out,
        // every colour slot inside 48 hours looked taken.
        clientType: patchType,
      });
      const atThatTime = slots.filter((sl) => sl.start === iso);
      const free = [...new Set(atThatTime.map((sl) => sl.stylistName ?? ""))];
      names = free;
      // Several free: the first is the one check_availability named when it
      // offered this time (it keeps the first slot at each start), so that
      // is who the caller was told. Asking "with whom?" instead sent one
      // call round in circles until the receptionist said "booked" anyway.
      if (free[0]) {
        stylist = matchStylist(free[0], cfg.stylists);
      }
    } catch (err) {
      console.warn("[RECEPTIONIST] Stylist inference failed:", err);
    }
    // Nobody can take it: closed, outside hours, too late to fit the
    // service, or already booked. Asking "with whom?" would send the caller
    // round in a circle for a slot that does not exist.
    if (names && names.length === 0) {
      return {
        success: false,
        notAvailable: true,
        message:
          "Nobody can take that time: the salon may be closed then, it may " +
          "run past closing, or it is booked. Call check_availability for " +
          "that day and offer one of the times it gives.",
      };
    }
  }

  if (!stylist) {
    return {
      success: false,
      message:
        "Which stylist is that with? More than one is free then, so say who " +
        "you offered it with.",
    };
  }

  // Also checked here, not only in check_availability: the agent can reach
  // book_appointment without having checked, and booking a colour specialist
  // for a cut is exactly the configuration the salon just set out to prevent.
  const bookingPairing = stylistServiceProblem(
    stylist.name,
    service,
    cfg.stylists
  );
  if (bookingPairing) {
    return { success: false, message: bookingPairing };
  }

  const slotIssue = await slotProblem(provider, organizationId, cfg, startsAt, service, stylist, {
    clientType: patchType,
    offeredOnly: true,
  });
  if (slotIssue) {
    return { success: false, today, notAvailable: true, message: slotIssue };
  }

  return {
    ok: true as const,
    booking: {
      provider,
      cfg,
      service,
      stylist,
      startsAt,
      clientName,
      phone,
      usedCallerId: resolvedPhone.source === "callerId",
      clientType,
      needsSkinTest: service.requiresPatchTest && patchType !== "returning",
      onFile,
      notes,
      today,
    } satisfies CheckedBooking,
  };
}

/** What would be booked, for the read-back: nothing is written. */
function readBackDetails(b: CheckedBooking) {
  const { cfg, startsAt } = b;
  return {
    success: true,
    ready: true,
    service: b.service.name,
    stylist: b.stylist.name,
    startsAt: zonedIsoString(startsAt, cfg.timeZone),
    // Weekday and date, always: what is read back is checked against a
    // calendar, and "Thursday" alone can be this week or next.
    when: `${new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(startsAt)} at ${spokenTime(startsAt.toISOString(), cfg.timeZone)}`,
    clientName: b.clientName,
    phone: b.phone,
    usedCallerId: b.usedCallerId,
    patchTestRequired: b.needsSkinTest,
    ...(b.onFile ? { patchTestOnRecord: b.onFile } : {}),
  };
}

/**
 * Write a checked booking: the client record, the diary entry (whose own
 * lock refuses a clash that crept in), the salon's notice, the confirmation
 * text, and the reply.
 */
async function writeBooking(organizationId: string, b: CheckedBooking) {
  const { provider, cfg, service, stylist, startsAt, clientName, phone, clientType, needsSkinTest, onFile, notes, today, usedCallerId } = b;


  // One number, one client record, but not always one person: a mum books
  // herself and her daughter on her own phone. The daughter goes on a record
  // of her own, reached through her mum's number (src/lib/client-link.ts).
  const { lead, contact } = await clientForBooking(organizationId, phone, clientName);
  const bookingNotes = blankToUndefined(notes);

  const written = await bookAppointment(
    provider,
    {
      organizationId,
      startsAt: startsAt.toISOString(),
      durationMinutes: service.durationMinutes,
      serviceName: service.name,
      stylistName: stylist.name,
      clientName,
      clientPhone: phone,
      clientEmail: lead.email,
      notes: bookingNotes,
      leadId: lead.id,
    },
    {
      organizationId,
      leadId: lead.id,
      serviceText: service.name,
      durationMinutes: service.durationMinutes,
      stylistName: stylist.name,
      clientType,
      patchTestRequired: needsSkinTest,
      notes: bookingNotes ?? null,
      source: "voice",
    }
  );

  if (!written.ok) {
    // No lying-true: the caller must not be told they are booked in.
    //
    // A slot taken by someone else is not a failure to hand to the salon:
    // the agent offers another time and the caller is still on the line to
    // pick one. Filing a callback there left a "COULD NOT BOOK" message for
    // someone who usually rebooked a minute later.
    if (written.conflict) {
      return {
        success: false,
        today,
        conflict: true,
        // "Taken while we were talking", or the stylist is blocked out
        // (lunch, holiday) or the salon closed — the reason says which.
        message: `${written.reason} Apologise and offer another time.`,
      };
    }

    // Anything else is the diary failing, and the caller has been told the
    // salon will ring. A callback is what makes that true.
    await prisma.callback.create({
      data: {
        organizationId,
        leadId: lead.id,
        assignedTo: stylist.name,
        // Listed by when the caller rang, like every message.
        scheduledAt: new Date(),
        notes: [
          `COULD NOT BOOK: ${written.reason}`,
          `Wanted: ${service.name} with ${stylist.name} at ${startsAt.toISOString()}`,
          bookingNotes,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });

    return {
      success: false,
      today,
      conflict: false,
      message:
        "The booking did not go through. Apologise, say the salon will ring to confirm, and do not tell the caller they are booked in.",
    };
  }

  const { appointment } = written;

  // Tell the salon: a pop-up on their screens, the diary's "new" colour, and
  // a push to the phones that asked for one. Not awaited: the caller is on
  // the line waiting to hear they are booked in.
  void noticeNewBooking(
    organizationId,
    {
      id: appointment.id,
      bookingNumber: appointment.bookingNumber,
      clientName,
      serviceText: service.name,
      stylistName: stylist.name,
      startsAt: appointment.startsAt,
    },
    cfg.timeZone
  );

  // Confirmation text. Deliberately after the appointment is committed and
  // deliberately not awaited into the booking's success: the appointment is
  // real whether or not the text lands, and the agent has already been told
  // it can confirm. A failure is recorded so staff can see it on the
  // appointment rather than discovering it from an unhappy client.
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { businessName: true, contactPhone: true },
  });

  // To the number it was booked on; a parent booking for a child is greeted
  // themselves and told whose booking it is.
  const sms = await sendSms(
    organizationId,
    phone,
    confirmationBody({
      clientName: contact ? contact.name : clientName,
      forName: contact ? (splitName(clientName).firstName ?? clientName) : null,
      bookingNumber: appointment.bookingNumber,
      serviceName: service.name,
      stylistName: stylist.name,
      whenText: describeAppointmentWhen(appointment.startsAt, cfg.timeZone),
      businessName: settings?.businessName ?? "the salon",
      contactPhone: settings?.contactPhone ?? null,
    })
  );

  await prisma.appointment.update({
    where: { id: appointment.id },
    data: sms.ok
      ? { confirmationSentAt: new Date(), confirmationError: null }
      : { confirmationError: sms.reason },
  });

  if (!sms.ok) {
    console.warn(
      `[SMS] Confirmation not sent for appointment ${appointment.id}: ${sms.reason}`
    );
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: "resolved" },
  });

  // The day as well as the time, so the read-back is the tool's words rather
  // than the model's own calendar arithmetic.
  const bookedDay = spokenDay(zonedDateString(appointment.startsAt, cfg.timeZone), cfg.timeZone);
  const bookedWhen =
    `${bookedDay === "today" || bookedDay === "tomorrow" ? bookedDay : `on ${bookedDay}`} ` +
    `at ${spokenTime(appointment.startsAt.toISOString(), cfg.timeZone)}`;

  return {
    success: true,
    today,
    startsAt: zonedIsoString(appointment.startsAt, cfg.timeZone),
    bookingNumber: appointment.bookingNumber,
    stylist: stylist.name,
    service: service.name,
    clientName,
    textSent: sms.ok,
    usedCallerId: usedCallerId,
    patchTestRequired: needsSkinTest,
    ...(onFile ? { patchTestOnRecord: onFile } : {}),
    message:
      `Booked: ${service.name} for ${clientName} with ${stylist.name} ${bookedWhen}. Confirm that ` +
      "in one sentence, without repeating what you said before booking" +
      (sms.ok ? ", and say a text is on its way." : ". Do NOT promise a text — one could not be sent.") +
      (onFile ? ` If it helps, they have a patch test on record from ${onFile}, so no new one is needed.` : "") +
      // A model left to explain the skin test invented one: "Jo will do it
      // as part of the colour appointment", which is the one thing it is not.
      (needsSkinTest
        ? " Also tell them, in one sentence: as a new colour client they need a quick skin " +
          "test at the salon at least 48 hours before, which is separate and which the salon " +
          "will be in touch to arrange."
        : "") +
      // Booked on caller ID: the number is the phone in their hand, and the
      // text has already gone to it. Asking afterwards whether the number is
      // right put a question to the caller about something they could not
      // change and had just been told was done; it only sounded unsure.
      (usedCallerId
        ? sms.ok
          ? " It is on the number they are ringing from, so say the text is on its way to this phone. " +
            "Do not read the number out or ask whether it is right."
          : // Why it failed is not the caller's business, and a guess ("a
            // landline?") is wrong whenever it was our side that failed.
            " It is on the number they are ringing from. The booking still stands; do not read the number out."
        : ""),
  };
}
