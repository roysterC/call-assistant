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
import { matchService, matchStylist } from "@/lib/salon-config";
import { normalisePhone, speakablePhone } from "@/lib/phone";
import {
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
 * Resolve the organization ID for a Vapi function call by inspecting the
 * call payload for a Vapi phone number ID or dialled number.
 */
export async function resolveOrgFromVapiPayload(
  body: Record<string, unknown>
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (body as any).message?.call || (body as any).call;
  if (!call) return null;

  const vapiPhoneNumberId = call.phoneNumberId || call.phoneNumber?.id || null;
  if (vapiPhoneNumberId) {
    const match = await prisma.phoneNumber.findFirst({
      where: { vapiPhoneNumberId, channel: "vapi" },
      select: { organizationId: true },
    });
    if (match) return match.organizationId;
  }

  const dialledNumber =
    call.phoneNumber?.number ||
    (typeof call.phoneNumber === "string" ? call.phoneNumber : null);
  if (dialledNumber) {
    const match = await prisma.phoneNumber.findUnique({
      where: { number: dialledNumber },
      select: { organizationId: true },
    });
    if (match) return match.organizationId;
  }

  // Web calls carry no phone number — there is nothing to dial — so fall back
  // to the assistant. This is not only for testing: an organization is tied to
  // its assistant regardless of how the call arrived, and a number may not
  // exist yet.
  const assistantId =
    call.assistantId ||
    call.assistant?.id ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (body as any).message?.assistant?.id ||
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
  | "transfer_call";

export const VAPI_FUNCTION_NAMES: VapiFunctionName[] = [
  "save_customer_details",
  "book_callback",
  "check_availability",
  "book_appointment",
  "transfer_call",
];

export function isVapiFunctionName(name: string): name is VapiFunctionName {
  return (VAPI_FUNCTION_NAMES as string[]).includes(name);
}

export async function handleSaveCustomerDetails(
  organizationId: string,
  params: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    businessType?: string;
    issue?: string;
  }
) {
  const { name, email, phone, company, businessType, issue } = params;

  const parsed = normalisePhone(phone);
  if (!parsed.ok) {
    // Do not store a number that cannot be rung or texted — ask again. A
    // plausible-looking wrong number is worse than none: the salon calls a
    // stranger and the appointment sits unconfirmed.
    return {
      success: false,
      message: `${parsed.reason} Read the number back to the caller digit by digit and confirm it.`,
    };
  }
  const normalisedPhone = parsed.e164;

  const lead = await prisma.lead.upsert({
    where: { organizationId_phone: { organizationId, phone: normalisedPhone } },
    update: {
      ...(name && { name }),
      ...(email && { email }),
      ...(company && { company }),
      ...(issue && { issue }),
    },
    create: {
      organizationId,
      phone: normalisedPhone,
      name: name || null,
      email: email || null,
      company: company || null,
      issue: businessType ? `[${businessType}] ${issue || ""}`.trim() : issue || null,
      source: "phone",
    },
  });

  return {
    success: true,
    message: `Customer details saved for ${lead.name || speakablePhone(normalisedPhone)}`,
    phone: normalisedPhone,
    leadId: lead.id,
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
    customerName?: string;
    clientType?: string;
    newClient?: boolean;
    notes?: string;
  }
) {
  const { time, customerPhone, customerName, notes } = params;

  const parsedPhone = normalisePhone(customerPhone);
  if (!parsedPhone.ok) {
    return {
      success: false,
      badPhone: true,
      message: `${parsedPhone.reason} Read it back digit by digit, confirm it, then book.`,
    };
  }
  const phone = parsedPhone.e164;

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

  await prisma.appointment.create({
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
    message:
      `Booked: ${service.name} with ${stylist.name} at ` +
      `${spokenTime(written.startsAt, cfg.timeZone)}. Confirm that back to the ` +
      "caller and let them know they will get a text.",
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
    case "transfer_call":
      return handleTransferCall(organizationId, parameters as Parameters<typeof handleTransferCall>[1]);
    default:
      return { error: `Unknown function: ${name}` };
  }
}
