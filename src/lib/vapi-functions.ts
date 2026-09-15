import { prisma } from "@/lib/prisma";
import {
  canCreateBooking,
  canReadAvailability,
  earliestBookableStart,
  getBookingProvider,
  getSalonConfig,
  summariseSlotsForSpeech,
} from "@/lib/booking";
import {
  filterSlotsByPreference,
  parseTimeOfDay,
} from "@/lib/booking/availability";
import {
  matchService,
  matchStylist,
  stylistDoesService,
  stylistsForService,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";
import { normalisePhone, speakablePhone } from "@/lib/phone";
import {
  cancellationBody,
  confirmationBody,
  rescheduleBody,
  sendSms,
} from "@/lib/sms";
import {
  describeAppointmentWhen,
  nextOpenMorning,
  parseDateOnly,
  resolveSpokenDate,
  zonedDateString,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";

/**
 * The Vapi tool handlers.
 *
 * Shared by both entry points: the envelope route, where Vapi names the
 * function in the body, and the path route, where an "API Request" tool posts
 * bare parameters and the name comes from the URL.
 */

/**
 * Work out which organization a Vapi payload belongs to.
 *
 * Vapi does not put the identifiers in one place. A tool call carries the
 * phone number under `message.call`; an end-of-call report carries it under
 * `message.phoneNumber`, a sibling of the call. The webhook route used to
 * have its own copy of this that only looked at the first, which is why tool
 * calls resolved and call records silently did not — the duplication was the
 * bug, not the lookup.
 *
 * Four routes to an answer, cheapest first:
 *   1. the Vapi phone-number id, if we have stored it
 *   2. the number that was dialled
 *   3. the assistant id — the only one a web call has, since there is no
 *      number to dial
 */
export async function resolveOrgFromVapiPayload(
  body: Record<string, unknown>
): Promise<string | null> {
  // Vapi's payloads are loosely shaped and vary by event, so this walks them
  // defensively rather than against a type that would only be half true.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const root = body as any;
  const message = root.message ?? root;
  const call = message?.call ?? root.call ?? {};
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // `message.phoneNumber` is where an end-of-call report puts it; `call.
  // phoneNumber` is where a tool call does.
  const phoneNumber = message?.phoneNumber ?? call?.phoneNumber ?? null;

  const vapiPhoneNumberId =
    call?.phoneNumberId ??
    message?.phoneNumberId ??
    (typeof phoneNumber === "object" ? phoneNumber?.id : null) ??
    null;

  if (vapiPhoneNumberId) {
    const match = await prisma.phoneNumber.findFirst({
      where: { vapiPhoneNumberId, channel: "vapi" },
      select: { organizationId: true },
    });
    if (match) return match.organizationId;
  }

  const dialledNumber =
    (typeof phoneNumber === "object" ? phoneNumber?.number : null) ??
    (typeof phoneNumber === "string" ? phoneNumber : null) ??
    null;

  if (dialledNumber) {
    const match = await prisma.phoneNumber.findUnique({
      where: { number: dialledNumber },
      select: { organizationId: true },
    });
    if (match) return match.organizationId;
  }

  // Web calls carry no phone number — there is nothing to dial — so fall back
  // to the assistant. Also covers an inbound number we have not mapped yet.
  const assistantId =
    call?.assistantId ??
    call?.assistant?.id ??
    message?.assistantId ??
    message?.assistant?.id ??
    (typeof phoneNumber === "object" ? phoneNumber?.assistantId : null) ??
    null;

  if (assistantId) {
    const match = await prisma.organizationSettings.findFirst({
      where: { vapiAssistantId: assistantId },
      select: { organizationId: true },
    });
    if (match) return match.organizationId;
  }

  return null;
}

export type VapiFunctionName =
  | "save_customer_details"
  | "book_callback"
  | "check_availability"
  | "book_appointment"
  | "find_appointment"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "transfer_call";

export const VAPI_FUNCTION_NAMES: VapiFunctionName[] = [
  "save_customer_details",
  "book_callback",
  "check_availability",
  "book_appointment",
  "find_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "transfer_call",
];

export function isVapiFunctionName(name: string): name is VapiFunctionName {
  return (VAPI_FUNCTION_NAMES as string[]).includes(name);
}

/** Loose enough to be useful, strict enough to reject a mis-heard word. */
function validEmail(raw: string | undefined): string | null {
  const e = blankToUndefined(raw);
  if (!e) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e.toLowerCase() : null;
}

/**
 * Settle on a usable number from what the agent sent and what Vapi knows.
 *
 * The model transcribes a number it heard spoken and gets it wrong — one call
 * sent "4782" while simultaneously holding the full number for the booking.
 * `callerNumber` is the caller ID, which Vapi can put in the tool body and
 * which nobody has to hear correctly.
 *
 * Caller ID is the fallback rather than the default because people ring on
 * behalf of others, and the number they give is the one they want used.
 */
type ResolvedPhone =
  | { ok: true; e164: string; source: "given" | "callerId" }
  | { ok: false; reason: string };

function resolveCallerPhone(
  spoken: string | undefined,
  callerId: string | undefined
): ResolvedPhone {
  const fromSpoken = normalisePhone(blankToUndefined(spoken));
  if (fromSpoken.ok) return { ok: true, e164: fromSpoken.e164, source: "given" };

  const fromCaller = normalisePhone(blankToUndefined(callerId));
  if (fromCaller.ok) return { ok: true, e164: fromCaller.e164, source: "callerId" };

  return {
    ok: false,
    reason: blankToUndefined(spoken)
      ? fromSpoken.reason
      : "No number was given.",
  };
}

export async function handleSaveCustomerDetails(
  organizationId: string,
  params: {
    name?: string;
    email?: string;
    phone?: string;
    /** Caller ID, if the Vapi tool body supplies it. */
    callerNumber?: string;
    company?: string;
    businessType?: string;
    issue?: string;
  }
) {
  const { name, email, phone, company, businessType, issue } = params;

  const cleanName = blankToUndefined(name);
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

  const lead = await prisma.lead.upsert({
    where: { organizationId_phone: { organizationId, phone: normalisedPhone } },
    update: {
      ...(cleanName && { name: cleanName }),
      ...(cleanEmail && { email: cleanEmail }),
      ...(cleanCompany && { company: cleanCompany }),
      ...(noteIssue && { issue: noteIssue }),
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
      `Saved for ${lead.name || speakablePhone(normalisedPhone)}.` +
      (resolved.source === "callerId"
        ? " The number they gave did not parse, so the number they are ringing from was used — confirm it with them."
        : ""),
  };
}

export async function handleBookCallback(
  organizationId: string,
  params: {
    date: string;
    time?: string;
    assignedTo?: string;
    notes?: string;
    customerPhone: string;
    customerName?: string;
  }
) {
  const { date, time, assignedTo, notes, customerPhone, customerName } = params;

  const parsedCallbackPhone = normalisePhone(customerPhone);
  if (!parsedCallbackPhone.ok) {
    return {
      success: false,
      message: `${parsedCallbackPhone.reason} Read it back and confirm it.`,
    };
  }
  const callbackPhone = parsedCallbackPhone.e164;

  let lead = await prisma.lead.findUnique({
    where: { organizationId_phone: { organizationId, phone: callbackPhone } },
  });

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        organizationId,
        phone: callbackPhone,
        name: customerName || null,
        source: "phone",
      },
    });
  }

  const scheduledAt = time ? new Date(`${date}T${time}`) : new Date(date);

  let teamMember = assignedTo;
  if (!teamMember) {
    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId },
    });
    const members = (settings?.teamMembers as Array<{ name: string }>) || [];
    teamMember = members[0]?.name || "Team";
  }

  // A callback is a phone call, so a lead with no number cannot have one
  // booked. Voice leads always have one; this guards the case where a website
  // lead (email-keyed, often no number) reaches this path.
  if (!lead.phone) {
    return {
      success: false,
      message: "That contact has no phone number on file to call back.",
    };
  }

  // A callback is best-effort against the calendar: if the provider write
  // fails we still record it locally, because losing the lead is worse than
  // losing the diary entry. `book_appointment` takes the opposite view — see
  // handleBookAppointment.
  let calendarEventId: string | null = null;
  const provider = await getBookingProvider(organizationId);
  if (canCreateBooking(provider)) {
    const written = await provider.createBooking({
      organizationId,
      startsAt: scheduledAt.toISOString(),
      durationMinutes: 30,
      serviceName: "Callback",
      stylistName: teamMember,
      clientName: lead.name || lead.phone,
      clientPhone: lead.phone,
      clientEmail: lead.email,
      notes,
      leadId: lead.id,
    });
    if (written.ok) {
      calendarEventId = written.ref;
    } else {
      console.warn(
        "[VAPI FUNCTIONS] Callback calendar write failed:",
        written.reason
      );
    }
  }

  await prisma.callback.create({
    data: {
      organizationId,
      leadId: lead.id,
      assignedTo: teamMember,
      scheduledAt,
      notes: notes || null,
      calendarEventId,
    },
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: "callback_booked" },
  });

  return {
    success: true,
    message: `Callback booked for ${scheduledAt.toLocaleString()} with ${teamMember}`,
    scheduledAt: scheduledAt.toISOString(),
  };
}

/** Vapi body templates send unset fields as "" — that means absent. */
function blankToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

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
function stylistServiceProblem(
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

function normaliseClientType(
  raw: string | undefined
): "new" | "returning" | "unknown" {
  const v = (blankToUndefined(raw) ?? "").toLowerCase();
  if (v === "new") return "new";
  if (v === "returning" || v === "existing" || v === "regular") return "returning";
  return "unknown";
}

/** "half past two" reads better than "14:30" down a phone line. */
function spokenTime(iso: string, timeZone: string): string {
  const { hour, minute } = zonedParts(new Date(iso), timeZone);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  if (minute === 0) return `${h12}${suffix}`;
  if (minute === 15) return `quarter past ${h12}`;
  if (minute === 30) return `half past ${h12}`;
  if (minute === 45) return `quarter to ${h12 === 12 ? 1 : h12 + 1}`;
  return `${h12}:${String(minute).padStart(2, "0")}${suffix}`;
}

export async function handleCheckAvailability(
  organizationId: string,
  params: {
    date?: string;
    /** The model sometimes sends a weekday under `day`. */
    day?: string;
    service?: string;
    stylist?: string;
    teamMember?: string;
    clientType?: string;
    /** Some phrasings produce a boolean instead of clientType. */
    newClient?: boolean;
    /** "morning" | "afternoon" | "evening" */
    timeOfDay?: string;
    /** "HH:MM" local — caller wants nothing before this. */
    after?: string;
    /** "HH:MM" local — caller wants nothing after this. */
    before?: string;
  }
) {
  const provider = await getBookingProvider(organizationId);

  // Belt to the type system's braces. Even if `check_availability` is left
  // attached in the Vapi console for an organization whose provider cannot
  // read a diary, the refusal is returned here — at the exact moment the model
  // would otherwise improvise a time. This is what replaced stubSlots().
  if (!canReadAvailability(provider)) {
    return {
      available: null,
      canCheck: false,
      message:
        "You cannot see the diary. Do not state or imply that any time is " +
        "free. Take the booking request and tell the caller the salon will " +
        "confirm it when they open.",
    };
  }

  const cfg = await getSalonConfig(organizationId);
  const service = matchService(blankToUndefined(params.service), cfg.services);

  if (!service) {
    return {
      available: null,
      canCheck: true,
      message:
        "Which service is that for? I need to know before I can check the " +
        "diary, because different services take different amounts of time.",
    };
  }

  const clientType = normaliseClientType(
    params.clientType ??
      (params.newClient === true
        ? "new"
        : params.newClient === false
          ? "returning"
          : undefined)
  );
  const stylistName =
    blankToUndefined(params.stylist) ?? blankToUndefined(params.teamMember);

  const pairing = stylistServiceProblem(stylistName, service, cfg.stylists);
  if (pairing) {
    return { available: null, canCheck: true, message: pairing };
  }

  // Callers say "Thursday"; the model has no dependable idea what today is.
  // Resolve against the salon's own clock rather than trusting it to compute.
  const date = resolveSpokenDate(params.date || params.day, cfg.timeZone);
  if (!date) {
    return {
      available: null,
      canCheck: true,
      message:
        "Which day did they mean? Ask for a specific day of the week or a " +
        "date, then call this again.",
    };
  }

  // A model with no reliable sense of today will happily produce a date from
  // two years ago. Rather than search an empty past, hand back today's date so
  // it can correct itself on the next call.
  const today = zonedDateString(new Date(), cfg.timeZone);
  if (date < today) {
    return {
      available: null,
      canCheck: true,
      today,
      message:
        `That date (${date}) is in the past. Today is ${today}. Work out the ` +
        "day the caller meant from that and call this again.",
    };
  }

  let slots;
  try {
    slots = await provider.getAvailability({
      organizationId,
      date,
      serviceName: service.name,
      stylistName,
      clientType,
    });
  } catch (err) {
    // Could not read the diary. Say so — never fall back to a guess.
    console.error("[VAPI FUNCTIONS] Availability lookup failed:", err);
    return {
      available: null,
      canCheck: false,
      message:
        "The diary could not be reached. Apologise, take the booking request, " +
        "and tell the caller the salon will confirm it when they open.",
    };
  }

  if (slots.length === 0) {
    // Distinguish "fully booked" from "too soon": the caller can act on the
    // second one, whereas the first just sounds like a brush-off.
    const floor = earliestBookableStart(service, clientType, new Date());
    if (floor.reason === "patch_test") {
      return {
        available: false,
        canCheck: true,
        today,
        patchTestRequired: true,
        message:
          `Nothing on that date. ${service.name} needs a skin patch test at ` +
          "least 48 hours beforehand for a new client, so the earliest we can " +
          "look at is two days away. Offer a later date.",
      };
    }
    return {
      available: false,
      canCheck: true,
      today,
      message:
        "Nothing free on that date for that service. Offer to try another day.",
    };
  }

  // Honour what the caller asked for. Offering nine in the morning to someone
  // who said "anytime after five" is the kind of thing that makes an agent
  // sound like it is not listening.
  const preference = {
    timeOfDay: parseTimeOfDay(blankToUndefined(params.timeOfDay)),
    after: blankToUndefined(params.after),
    before: blankToUndefined(params.before),
  };
  const preferred = filterSlotsByPreference(slots, cfg.timeZone, preference);
  const hasPreference = Boolean(
    preference.timeOfDay || preference.after || preference.before
  );

  if (hasPreference && preferred.length === 0) {
    // Do not silently widen the search — say plainly that the window is full
    // and offer what does exist, so the caller chooses rather than the agent
    // quietly ignoring them.
    const fallback = summariseSlotsForSpeech(slots, 3).map((s) => ({
      time: spokenTime(s.start, cfg.timeZone),
      startsAt: s.start,
      stylist: s.stylistName,
    }));
    return {
      available: false,
      canCheck: true,
      today,
      date,
      outsidePreference: true,
      alternatives: fallback,
      message:
        "Nothing free in the window they asked for. Say so plainly, then " +
        `offer these instead if they are interested: ${fallback
          .map((o) => `${o.time} with ${o.stylist}`)
          .join(", ")}.`,
    };
  }

  const picked = summariseSlotsForSpeech(
    hasPreference ? preferred : slots,
    3
  );
  const options = picked.map((s) => ({
    time: spokenTime(s.start, cfg.timeZone),
    startsAt: s.start,
    stylist: s.stylistName,
  }));

  return {
    available: true,
    canCheck: true,
    // Every response carries the date, so the model can orient from the first
    // successful call rather than guessing and being corrected afterwards.
    today,
    date,
    service: service.name,
    durationMinutes: service.durationMinutes,
    options,
    message:
      `Offer these times: ${options
        .map((o) => `${o.time} with ${o.stylist}`)
        .join(", ")}. When the caller picks one, call book_appointment with ` +
      "the exact startsAt value for that option.",
  };
}

export async function handleBookAppointment(
  organizationId: string,
  params: {
    date?: string;
    day?: string;
    time: string;
    service: string;
    stylist?: string;
    customerPhone: string;
    /** Caller ID, if the Vapi tool body supplies it. */
    callerNumber?: string;
    customerName?: string;
    clientType?: string;
    newClient?: boolean;
    notes?: string;
  }
) {
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
  const service = matchService(params.service, cfg.services);
  if (!service) {
    return {
      success: false,
      message:
        `That service was not recognised ("${params.service}"). Ask the ` +
        "caller to describe what they would like done.",
    };
  }

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
  if (/^\d{4}-\d{2}-\d{2}T/.test(time)) {
    startsAt = new Date(time);
  } else {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(time).trim());
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

  // No stylist named: work out who owns the slot that was offered.
  if (!stylist && canReadAvailability(provider)) {
    const iso = startsAt.toISOString();
    try {
      const slots = await provider.getAvailability({
        organizationId,
        date: resolveSpokenDate(params.date || params.day, cfg.timeZone) ?? "",
        serviceName: service.name,
      });
      const atThatTime = slots.filter((sl) => sl.start === iso);
      const names = [...new Set(atThatTime.map((sl) => sl.stylistName))];
      if (names.length === 1 && names[0]) {
        stylist = matchStylist(names[0], cfg.stylists);
      }
    } catch (err) {
      console.warn("[VAPI FUNCTIONS] Stylist inference failed:", err);
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

  const today = zonedDateString(new Date(), cfg.timeZone);

  const clientType = normaliseClientType(
    params.clientType ??
      (params.newClient === true
        ? "new"
        : params.newClient === false
          ? "returning"
          : undefined)
  );

  // Re-apply the lead-time rules here as well as in availability. The model
  // can reach book_appointment without ever calling check_availability, and a
  // patch-test window is not something to enforce only on the happy path.
  const floor = earliestBookableStart(service, clientType, new Date());
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

  const lead = await prisma.lead.upsert({
    where: { organizationId_phone: { organizationId, phone } },
    update: { ...(customerName && { name: customerName }) },
    create: {
      organizationId,
      phone,
      name: customerName || null,
      source: "phone",
    },
  });

  const written = await provider.createBooking({
    organizationId,
    startsAt: startsAt.toISOString(),
    durationMinutes: service.durationMinutes,
    serviceName: service.name,
    stylistName: stylist.name,
    clientName: lead.name || speakablePhone(phone),
    clientPhone: phone,
    clientEmail: lead.email,
    notes,
    leadId: lead.id,
  });

  if (!written.ok) {
    // No lying-true: the caller must not be told they are booked in. Fall
    // back to a callback so the lead is still not lost.
    const fallbackAt =
      nextOpenMorning(cfg.hours, cfg.timeZone, new Date()) ?? new Date();
    await prisma.callback.create({
      data: {
        organizationId,
        leadId: lead.id,
        assignedTo: stylist.name,
        scheduledAt: fallbackAt,
        notes: [
          `COULD NOT BOOK: ${written.reason}`,
          `Wanted: ${service.name} with ${stylist.name} at ${startsAt.toISOString()}`,
          notes,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });

    return {
      success: false,
      today,
      conflict: Boolean(written.conflict),
      message: written.conflict
        ? "That slot was taken while we were talking. Apologise and offer another time."
        : "The booking did not go through. Apologise, say the salon will ring to confirm, and do not tell the caller they are booked in.",
    };
  }

  const appointment = await prisma.appointment.create({
    data: {
      organizationId,
      leadId: lead.id,
      serviceText: service.name,
      durationMinutes: service.durationMinutes,
      stylistName: stylist.name,
      startsAt: new Date(written.startsAt),
      endsAt: new Date(written.endsAt),
      googleEventId: written.ref,
      googleCalendarId: written.calendarId ?? null,
      clientType,
      patchTestRequired:
        service.requiresPatchTest && clientType !== "returning",
      notes: notes || null,
      source: "voice",
    },
  });

  // Confirmation text. Deliberately after the appointment is committed and
  // deliberately not awaited into the booking's success: the appointment is
  // real whether or not the text lands, and the agent has already been told
  // it can confirm. A failure is recorded so staff can see it on the
  // appointment rather than discovering it from an unhappy client.
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { businessName: true, contactPhone: true },
  });

  const sms = await sendSms(
    organizationId,
    phone,
    confirmationBody({
      clientName: lead.name,
      serviceName: service.name,
      stylistName: stylist.name,
      whenText: describeAppointmentWhen(new Date(written.startsAt), cfg.timeZone),
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

  return {
    success: true,
    today,
    startsAt: written.startsAt,
    stylist: stylist.name,
    service: service.name,
    textSent: sms.ok,
    message:
      `Booked: ${service.name} with ${stylist.name} at ` +
      `${spokenTime(written.startsAt, cfg.timeZone)}. Confirm that back to the ` +
      (sms.ok
        ? "caller and let them know they will get a text confirming it."
        : "caller. Do NOT promise a text — one could not be sent."),
  };
}

export async function handleTransferCall(
  organizationId: string,
  params: { teamMember?: string; reason?: string }
) {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId },
  });
  const members = (settings?.teamMembers as Array<{ name: string; phone: string }>) || [];

  const member = params.teamMember
    ? members.find((m) => m.name.toLowerCase().includes(params.teamMember!.toLowerCase()))
    : members[0];

  if (!member?.phone) {
    return {
      success: false,
      message: "No team member available for transfer. Would you like to book a callback instead?",
    };
  }

  return {
    success: true,
    destination: {
      type: "number",
      number: member.phone,
      message: `Transferring you to ${member.name} now.`,
    },
  };
}


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
  lead: { id: string; name: string | null; phone: string | null };
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
  const lead = await prisma.lead.findUnique({
    where: { organizationId_phone: { organizationId, phone } },
    select: { id: true },
  });

  if (!lead) {
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

  const upcoming = await prisma.appointment.findMany({
    where: {
      organizationId,
      leadId: lead.id,
      status: "booked",
      startsAt: { gte: new Date() },
    },
    include: { lead: { select: { id: true, name: true, phone: true } } },
    orderBy: { startsAt: "asc" },
  });

  if (upcoming.length === 0) {
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
        when: describeAppointmentWhen(a.startsAt, timeZone),
        service: a.serviceText,
        stylist: a.stylistName,
      })),
      message:
        "There is more than one booked. Read them out, ask which they mean, " +
        "then call again with that appointmentId.",
    },
  };
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
  params: { customerPhone?: string; phone?: string }
) {
  const parsed = normalisePhone(params.customerPhone ?? params.phone);
  if (!parsed.ok) {
    return { found: false, message: `${parsed.reason} Ask for it again.` };
  }

  const cfg = await getSalonConfig(organizationId);
  const resolved = await resolveAppointment(
    organizationId,
    parsed.e164,
    undefined,
    cfg.timeZone
  );

  if (!resolved.ok) return resolved.result;

  const a = resolved.appointment;
  return {
    found: true,
    appointmentId: a.id,
    when: describeAppointmentWhen(a.startsAt, cfg.timeZone),
    service: a.serviceText,
    stylist: a.stylistName,
    clientName: a.lead.name,
    message:
      `They have ${a.serviceText.toLowerCase()} with ${a.stylistName} ` +
      `${describeAppointmentWhen(a.startsAt, cfg.timeZone)}. Read that back ` +
      "and confirm it is the one they mean before changing anything.",
  };
}

export async function handleCancelAppointment(
  organizationId: string,
  params: {
    customerPhone?: string;
    phone?: string;
    appointmentId?: string;
    reason?: string;
  }
) {
  const parsed = normalisePhone(params.customerPhone ?? params.phone);
  if (!parsed.ok) {
    return { success: false, message: `${parsed.reason} Ask for it again.` };
  }

  const cfg = await getSalonConfig(organizationId);
  const resolved = await resolveAppointment(
    organizationId,
    parsed.e164,
    blankToUndefined(params.appointmentId),
    cfg.timeZone
  );
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
      console.error("[VAPI FUNCTIONS] Calendar cancellation failed:", err);
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
  const sms = await sendSms(
    organizationId,
    parsed.e164,
    cancellationBody({
      clientName: appt.lead.name,
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
      `Cancelled: ${appt.serviceText} with ${appt.stylistName} ${whenText}. ` +
      "Confirm that back to the caller" +
      (sms.ok ? " and say a text is coming." : ", but do not promise a text.") +
      " Offer to rebook if they want another time.",
  };
}

export async function handleRescheduleAppointment(
  organizationId: string,
  params: {
    customerPhone?: string;
    phone?: string;
    appointmentId?: string;
    date?: string;
    day?: string;
    time: string;
    stylist?: string;
  }
) {
  const parsed = normalisePhone(params.customerPhone ?? params.phone);
  if (!parsed.ok) {
    return { success: false, message: `${parsed.reason} Ask for it again.` };
  }

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

  const resolved = await resolveAppointment(
    organizationId,
    parsed.e164,
    blankToUndefined(params.appointmentId),
    cfg.timeZone
  );
  if (!resolved.ok) return { success: false, ...resolved.result };

  const appt = resolved.appointment;
  const previousWhenText = describeAppointmentWhen(appt.startsAt, cfg.timeZone);

  const newDate = resolveSpokenDate(params.date || params.day, cfg.timeZone);
  if (!newDate) {
    return {
      success: false,
      message: "Which day did they want to move to? Ask, then call again.",
    };
  }

  let startsAt: Date;
  if (/^\d{4}-\d{2}-\d{2}T/.test(params.time)) {
    startsAt = new Date(params.time);
  } else {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(params.time).trim());
    if (!m) {
      return { success: false, message: `That time did not parse ("${params.time}").` };
    }
    const d = parseDateOnly(newDate);
    startsAt = zonedWallTimeToUtc(d.year, d.month, d.day, Number(m[1]), Number(m[2]), cfg.timeZone);
  }
  if (Number.isNaN(startsAt.getTime())) {
    return { success: false, message: "That date and time did not parse." };
  }

  const service = matchService(appt.serviceText, cfg.services);
  if (!service) {
    return {
      success: false,
      message:
        `The original service (${appt.serviceText}) is no longer in the list, ` +
        "so its length is unknown. Take a message for the salon.",
    };
  }

  // The lead-time rules apply to the new slot as much as the original. A
  // colour moved inside the patch-test window is the same hazard whether it
  // was booked that way or moved there.
  const clientType =
    appt.clientType === "returning" ? "returning" : appt.patchTestRequired ? "new" : "unknown";
  const floor = earliestBookableStart(service, clientType, new Date());
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

  // Book the new slot BEFORE releasing the old one. If this ordering were
  // reversed and the new time turned out to be taken, the caller would be left
  // with no appointment at all — having rung up to keep one.
  const written = await provider.createBooking({
    organizationId,
    startsAt: startsAt.toISOString(),
    durationMinutes: service.durationMinutes,
    serviceName: service.name,
    stylistName: stylist.name,
    clientName: appt.lead.name || parsed.e164,
    clientPhone: parsed.e164,
    notes: `Moved from ${previousWhenText}`,
    leadId: appt.lead.id,
  });

  if (!written.ok) {
    return {
      success: false,
      conflict: Boolean(written.conflict),
      keptOriginal: true,
      message: written.conflict
        ? `That time is taken. Their original appointment ${previousWhenText} is untouched — offer another time.`
        : `Could not move it. Their original appointment ${previousWhenText} still stands. Say the salon will ring to sort it.`,
    };
  }

  // New slot secured; now release the old one.
  let oldCleared = true;
  if (appt.googleEventId && provider.cancelBooking) {
    try {
      await provider.cancelBooking(
        organizationId,
        appt.googleEventId,
        appt.googleCalendarId ?? undefined
      );
    } catch (err) {
      oldCleared = false;
      console.error("[VAPI FUNCTIONS] Releasing the old slot failed:", err);
    }
  }

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: {
      startsAt: new Date(written.startsAt),
      endsAt: new Date(written.endsAt),
      stylistName: stylist.name,
      googleEventId: written.ref,
      googleCalendarId: written.calendarId ?? null,
      // A reminder for the old date must not go out for the new one.
      reminderSentAt: null,
      reminderError: null,
      notes: [
        appt.notes,
        `Moved from ${previousWhenText} by phone` +
          (oldCleared ? "" : " — OLD CALENDAR ENTRY NOT REMOVED, delete it by hand"),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  });

  const whenText = describeAppointmentWhen(updated.startsAt, cfg.timeZone);
  const ctx = await orgMessageContext(organizationId);
  const sms = await sendSms(
    organizationId,
    parsed.e164,
    rescheduleBody({
      clientName: appt.lead.name,
      serviceName: service.name,
      stylistName: stylist.name,
      whenText,
      previousWhenText,
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
      `Moved to ${whenText} with ${stylist.name}. Confirm that back to the ` +
      "caller" +
      (sms.ok ? " and say a text is coming." : ", but do not promise a text."),
  };
}

/**
 * Route a named call to its handler.
 *
 * Parameters are deliberately loose: the model does not always use the field
 * names in the schema, so each handler normalises what it is given rather than
 * relying on the caller to have got it right.
 */
export async function executeVapiFunction(
  name: string,
  organizationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any>
): Promise<unknown> {
  switch (name) {
    case "save_customer_details":
      return handleSaveCustomerDetails(organizationId, parameters as Parameters<typeof handleSaveCustomerDetails>[1]);
    case "book_callback":
      return handleBookCallback(organizationId, parameters as Parameters<typeof handleBookCallback>[1]);
    case "check_availability":
      return handleCheckAvailability(organizationId, parameters as Parameters<typeof handleCheckAvailability>[1]);
    case "book_appointment":
      return handleBookAppointment(organizationId, parameters as Parameters<typeof handleBookAppointment>[1]);
    case "find_appointment":
      return handleFindAppointment(organizationId, parameters as Parameters<typeof handleFindAppointment>[1]);
    case "cancel_appointment":
      return handleCancelAppointment(organizationId, parameters as Parameters<typeof handleCancelAppointment>[1]);
    case "reschedule_appointment":
      return handleRescheduleAppointment(organizationId, parameters as Parameters<typeof handleRescheduleAppointment>[1]);
    case "transfer_call":
      return handleTransferCall(organizationId, parameters as Parameters<typeof handleTransferCall>[1]);
    default:
      return { error: `Unknown function: ${name}` };
  }
}
