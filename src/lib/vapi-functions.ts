import { prisma } from "@/lib/prisma";
import { bookAppointment, moveAppointment } from "@/lib/booking/diary";
import {
  canCreateBooking,
  canReadAvailability,
  earliestBookableStart,
  getBookingProvider,
  getSalonConfig,
  summariseSlotsForSpeech,
  type SalonConfig,
} from "@/lib/booking";
import type { BookingProvider } from "@/lib/booking/types";
import {
  DEFAULT_SEARCH_DAYS,
  filterSlotsByPreference,
  opennessRatio,
  parseTimeOfDay,
  type SlotPreference,
} from "@/lib/booking/availability";
import type { TimeSlot } from "@/lib/booking/types";
import {
  matchStylist,
  resolveBookedService,
  serviceIsStaffedOn,
  stylistDoesService,
  stylistsForService,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";
import { normalisePhone, speakablePhone } from "@/lib/phone";
import { nameRequiredMessage, normaliseCallerName } from "@/lib/caller-name";
import {
  cancellationBody,
  confirmationBody,
  rescheduleBody,
  sendSms,
  type SmsResult,
} from "@/lib/sms";
import {
  addCalendarDays,
  describeAppointmentWhen,
  nextOpenMorning,
  openWindowFor,
  parseDateOnly,
  parseSpokenTime,
  resolveSpokenDate,
  zonedDateString,
  zonedIsoString,
  zonedParts,
  hoursForWeekday,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import { namesMatch, splitName } from "@/lib/client-name";
import { clientForBooking, peopleOnNumber, textRecipient } from "@/lib/client-link";

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
/**
 * The number the caller is ringing from, off the call itself.
 *
 * `callerNumber` has been a parameter on the booking tools all along, with a
 * description telling the model to send it "if the tool supplies it" — but
 * nothing ever supplied it. The model cannot see the caller ID, so the
 * parameter was never filled and the fallback behind it never ran. A caller
 * saying "use the number I'm ringing from" left the agent with nothing, which
 * is how it ended up agreeing that the number worked and then asking for it.
 *
 * Read here instead, from the payload Vapi already sends, and injected by the
 * route so every handler gets it whatever the model did or did not send.
 */
export function callerNumberFromVapiPayload(
  body: Record<string, unknown>
): string | null {
  // Walked defensively, for the same reason resolveOrgFromVapiPayload is:
  // the shape varies by event and a type here would only be half true.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const root = body as any;
  const message = root.message ?? root;
  const call = message?.call ?? root.call ?? {};
  const customer = call?.customer ?? message?.customer ?? root.customer ?? null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const number = typeof customer?.number === "string" ? customer.number : null;
  return blankToUndefined(number ?? undefined) ?? null;
}

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

/**
 * What to tell the agent when the spoken services did not fully resolve.
 *
 * Shared by availability, booking and rescheduling. The half-understood case
 * gets its own wording on purpose: naming what was recognised lets the model
 * correct one service rather than start the whole request again.
 */
function serviceNotResolvedMessage(
  spoken: string | undefined,
  matched: SalonService[],
  unmatched: string[]
): string {
  if (matched.length === 0) {
    return (
      `That service was not recognised ("${spoken ?? ""}"). Ask the caller ` +
      "to describe what they would like done."
    );
  }
  return (
    `I have ${matched.map((s) => s.name).join(" and ")}, but not ` +
    `"${unmatched.join('", "')}". Ask the caller what that is, then send ` +
    "every service they want in one call so the diary allows time for all of it."
  );
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

  const parsedCallbackName = normaliseCallerName(customerName);
  if (!parsedCallbackName.ok) {
    return {
      success: false,
      missingName: true,
      message: nameRequiredMessage(parsedCallbackName.reason),
    };
  }
  const callbackName = parsedCallbackName.name;

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
        name: callbackName,
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
  //
  // On the salon's own diary a callback is not written into it at all: it is
  // a phone call, not a chair, and it lives in the callbacks list.
  let calendarEventId: string | null = null;
  const provider = await getBookingProvider(organizationId);
  if (canCreateBooking(provider) && provider.id !== "native") {
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

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Whether anyone who performs `service` is rostered on the weekday that
 * `date` falls on, in the salon's timezone.
 *
 * Anchored at noon before reading the weekday, the same way availability
 * does it: midnight can land on the other side of a DST shift and report
 * the neighbouring day.
 */
function serviceStaffedOnDate(
  cfg: SalonConfig,
  service: SalonService,
  date: string
): boolean {
  const { year, month, day } = parseDateOnly(date);
  const noon = zonedWallTimeToUtc(year, month, day, 12, 0, cfg.timeZone);
  const { weekday } = zonedParts(noon, cfg.timeZone);
  return serviceIsStaffedOn(service, cfg.stylists, weekday);
}

/**
 * Name a day the way someone says it out loud.
 *
 * A forward search answers about a day the caller did not name, so the day
 * has to come back with the time — "quarter to twelve" on its own is how
 * somebody turns up on the wrong morning.
 */
function spokenDay(date: string, timeZone: string, now = new Date()): string {
  const today = zonedDateString(now, timeZone);
  if (date === today) return "today";
  if (date === addCalendarDays(today, 1)) return "tomorrow";

  const { year, month, day } = parseDateOnly(date);
  const noon = zonedWallTimeToUtc(year, month, day, 12, 0, timeZone);
  const name = DAY_NAMES[zonedParts(noon, timeZone).weekday];

  // Past a week a weekday name alone is ambiguous — "Thursday" could be
  // either of two, and the caller will assume the nearer one.
  if (date <= addCalendarDays(today, 6)) return name;

  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${name} the ${day}${suffix}`;
}

/**
 * "Saturday", said on a Saturday, means a week today: today is its own word.
 * But a caller ringing on a Saturday afternoon may well mean today, and a
 * receptionist handed next week's diary without being told so said "this
 * Saturday is fully booked". So the answer says which Saturday it is about.
 */
export async function handleCheckAvailability(
  organizationId: string,
  params: Parameters<typeof checkAvailability>[1]
) {
  const result = await checkAvailability(organizationId, params);
  const asked = (params.date || params.day || "").trim().toLowerCase().replace(/^(this|on)\s+/, "");
  const r = result as { today?: string; date?: string; requestedDate?: string; message?: unknown };
  if (!r.today || typeof r.message !== "string") return result;
  const todayName = DAY_NAMES[new Date(`${r.today}T12:00:00Z`).getUTCDay()];
  const answeredFor = r.requestedDate ?? r.date;
  if (asked !== todayName.toLowerCase() || !answeredFor || answeredFor === r.today) return result;
  return {
    ...result,
    message:
      `Today is ${todayName}, so "${params.date || params.day}" was taken as a week today, ` +
      `not today; if they meant today, check "today". ${r.message}`,
  };
}

async function checkAvailability(
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
    /** "earliest" when they asked for the soonest rather than a choice. */
    prefer?: string;
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
  // Every service the caller named, folded into one appointment. A cut and a
  // colour is one slot as long as both of them together, and checking for
  // only one of them offers a time that will not fit the work.
  const resolvedService = resolveBookedService(
    blankToUndefined(params.service),
    cfg.services
  );

  if (!resolvedService.ok) {
    return {
      available: null,
      canCheck: true,
      message:
        resolvedService.matched.length === 0
          ? "Which service is that for? I need to know before I can check " +
            "the diary, because different services take different amounts " +
            "of time."
          : serviceNotResolvedMessage(
              params.service,
              resolvedService.matched,
              resolvedService.unmatched
            ),
    };
  }
  const service = resolvedService.service;

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

  // A name that is nobody here. Searching everyone instead would read out
  // other stylists' times as if they were the one asked for. Usually the
  // line mishearing a name ("Joe" for "Jo"), so the team is listed.
  if (stylistName && !matchStylist(stylistName, cfg.stylists)) {
    return {
      available: null,
      canCheck: true,
      unknownStylist: true,
      team: cfg.stylists.map((st) => st.name),
      message:
        `"${stylistName}" is not a stylist here. The team is ` +
        `${cfg.stylists.map((st) => st.name).join(", ")}. Check the name ` +
        "with the caller, then call this again.",
    };
  }

  const pairing = stylistServiceProblem(stylistName, service, cfg.stylists);
  if (pairing) {
    return { available: null, canCheck: true, message: pairing };
  }

  const wants: SlotPreference =
    (blankToUndefined(params.prefer) ?? "").toLowerCase() === "earliest"
      ? "earliest"
      : "any";

  const today = zonedDateString(new Date(), cfg.timeZone);

  // Callers say "Thursday"; the model has no dependable idea what today is.
  // Resolve against the salon's own clock rather than trusting it to compute.
  let date = resolveSpokenDate(params.date || params.day, cfg.timeZone);
  if (!date) {
    // "As soon as you can" is already an answer to "which day?" — asking
    // again is the deafness this whole path exists to avoid. Start from today
    // and let the forward search find the day.
    if (wants !== "earliest") {
      return {
        available: null,
        canCheck: true,
        message:
          "Which day did they mean? Ask for a specific day of the week or a " +
          "date, then call this again.",
      };
    }
    date = today;
  }

  // A model with no reliable sense of today will happily produce a date from
  // two years ago. Rather than search an empty past, hand back today's date so
  // it can correct itself on the next call.
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

  const canLookAhead = provider.capabilities.forwardSearch;

  /** One availability read. `days` of 1 is the single day it always was. */
  const read = async (fromDate: string, days: number): Promise<TimeSlot[]> =>
    provider.getAvailability({
      organizationId,
      date: fromDate,
      serviceName: service.name,
      stylistName,
      clientType,
      searchDays: days,
    });

  // Honour what the caller asked for. Offering nine in the morning to someone
  // who said "anytime after five" is the kind of thing that makes an agent
  // sound like it is not listening — which applies just as much to the day we
  // look ahead to as to the day they named.
  const preference = {
    timeOfDay: parseTimeOfDay(blankToUndefined(params.timeOfDay)),
    after: blankToUndefined(params.after),
    before: blankToUndefined(params.before),
  };
  const hasPreference = Boolean(
    preference.timeOfDay || preference.after || preference.before
  );

  let slots: TimeSlot[];
  try {
    // Someone asking for the soonest is not asking about a particular day, so
    // searching one and reporting nothing would answer a question they did
    // not ask. The whole range costs one free/busy query.
    slots = await read(
      date,
      wants === "earliest" && canLookAhead ? DEFAULT_SEARCH_DAYS : 1
    );
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

  /** Slots on the soonest day that has any, as spoken options. */
  const optionsForSoonestDay = (
    list: TimeSlot[],
    preference: SlotPreference = "any"
  ) => {
    if (list.length === 0) {
      return { date: null as string | null, options: [], slots: [] as TimeSlot[] };
    }

    // Two days' times read out as one list is how somebody books Thursday and
    // turns up on Wednesday. Answer about one day.
    const day = zonedDateString(new Date(list[0].start), cfg.timeZone);
    const sameDay = list.filter(
      (s) => zonedDateString(new Date(s.start), cfg.timeZone) === day
    );
    const picked = summariseSlotsForSpeech(sameDay, {
      max: 3,
      // Options have to be far enough apart to be different. A gap of at
      // least the service length means back-to-back at the tightest, rather
      // than three readings of the same answer fifteen minutes apart.
      minGapMinutes: Math.max(45, service.durationMinutes),
      preference,
    });
    return {
      date: day as string | null,
      slots: sameDay,
      options: picked.map((s) => ({
        time: spokenTime(s.start, cfg.timeZone),
        // In the salon's clock, so the digits match the time just spoken.
        startsAt: zonedIsoString(new Date(s.start), cfg.timeZone),
        stylist: s.stylistName,
      })),
    };
  };

  if (slots.length === 0) {
    // Distinguish "fully booked" from "too soon": the caller can act on the
    // second one, whereas the first just sounds like a brush-off.
    const floor = earliestBookableStart(service, clientType, new Date(), undefined, undefined, cfg);

    // "Try another day" makes the caller do the work, and usually ends the
    // call. Look forward and name one instead. This is a second read, and it
    // only happens on a day that came back empty.
    let ahead: ReturnType<typeof optionsForSoonestDay> | null = null;
    let aheadMatchedPreference = true;
    if (canLookAhead && wants !== "earliest") {
      try {
        const found = await read(
          addCalendarDays(date, 1),
          DEFAULT_SEARCH_DAYS - 1
        );
        const inWindow = filterSlotsByPreference(
          found,
          cfg.timeZone,
          preference
        );
        // Someone who said "after four" and is then offered eleven in the
        // morning on a different day has been listened to twice as badly.
        // Fall back to anything only when their window has nothing at all.
        aheadMatchedPreference = !hasPreference || inWindow.length > 0;
        ahead = optionsForSoonestDay(
          inWindow.length > 0 ? inWindow : found,
          "earliest"
        );
      } catch (err) {
        // The answer about the day they asked for is still true and useful.
        console.error("[VAPI FUNCTIONS] Look-ahead failed:", err);
      }
    }

    const nextAvailable =
      ahead && ahead.date && ahead.options.length > 0
        ? { date: ahead.date, options: ahead.options }
        : undefined;
    const offer = nextAvailable
      ? (aheadMatchedPreference
          ? " The next free is "
          : " Nothing in the window they asked for at all, but the next free is ") +
        `${spokenDay(nextAvailable.date, cfg.timeZone)} at ` +
        `${nextAvailable.options[0].time} with ` +
        `${nextAvailable.options[0].stylist} — offer that.`
      : "";

    // Shut is not the same as full. A caller told "nothing free Thursday"
    // asks about next Thursday; one told the salon is closed on Thursdays
    // asks about another day.
    const closed = openWindowFor(cfg.hours, cfg.timeZone, date) === null;

    // Open, but nobody who does this service is rostered. Not a busy day —
    // an unstaffed one, and it will read the same every week until the roster
    // changes. Only worth saying when the salon is actually open: shut is the
    // better explanation when both are true.
    const unstaffed = !closed && !serviceStaffedOnDate(cfg, service, date);

    // Later today than the service can still fit: the day is over, not full.
    const window = closed ? null : openWindowFor(cfg.hours, cfg.timeZone, date);
    const overForToday =
      date === today &&
      window !== null &&
      Date.now() + service.durationMinutes * 60_000 > window.end.getTime();

    if (floor.reason === "patch_test") {
      return {
        available: false,
        canCheck: true,
        today,
        date,
        patchTestRequired: true,
        nextAvailable,
        message:
          `Nothing on that date. ${service.name} needs a skin patch test at ` +
          "least 48 hours beforehand for a new client, done at the salon while it " +
          `is open, so the earliest is ${spokenDay(zonedDateString(floor.at, cfg.timeZone), cfg.timeZone)}.` +
          `${offer || " Offer a later date."}`,
      };
    }

    const searchedRange = wants === "earliest" && canLookAhead;
    return {
      available: false,
      canCheck: true,
      today,
      date,
      searchedDays: searchedRange ? DEFAULT_SEARCH_DAYS : 1,
      nextAvailable,
      closed,
      unstaffed,
      message: searchedRange
        ? `Nothing free for ${service.name.toLowerCase()} in the next two ` +
          "weeks. Say so, take their details, and tell them the salon will " +
          "ring back with something."
        : closed
          ? `The salon is closed on ${spokenDay(date, cfg.timeZone)} — say ` +
            `that, not that it is booked up.${offer || " Ask which other day suits."}`
          : overForToday
            ? "It is too late in the day for that today: the salon is closing or " +
              `has closed. Say that, not that it is booked up.${offer || " Ask which other day suits."}`
          : unstaffed
            ? `Nobody who does ${service.name.toLowerCase()} works ` +
              `${spokenDay(date, cfg.timeZone)} — say that it is not a day we ` +
              "offer it, not that it is booked up, so they do not ask again " +
              `for the same day next week.${offer || " Ask which other day suits."}`
            : `Nothing free on ${spokenDay(date, cfg.timeZone)} for that ` +
              `service.${offer || " Offer to try another day."}`,
    };
  }

  const preferred = filterSlotsByPreference(slots, cfg.timeZone, preference);

  if (hasPreference && preferred.length === 0) {
    // Do not silently widen the search — say plainly that the window is full
    // and offer what does exist, so the caller chooses rather than the agent
    // quietly ignoring them.
    const fallback = optionsForSoonestDay(slots);
    return {
      available: false,
      canCheck: true,
      today,
      date: fallback.date ?? date,
      outsidePreference: true,
      alternatives: fallback.options,
      message:
        "Nothing free in the window they asked for. Say so plainly, then " +
        `offer these instead if they are interested: ${fallback.options
          .map((o) => `${o.time} with ${o.stylist}`)
          .join(", ")}.`,
    };
  }

  const found = optionsForSoonestDay(hasPreference ? preferred : slots, wants);
  const foundDate = found.date ?? date;
  const options = found.options;

  // The search may have walked past the day they named, or past today when
  // they named no day at all. Either way the answer is about a different day
  // and the answer has to say so.
  const movedOn = foundDate !== date;
  const dayPhrase = spokenDay(foundDate, cfg.timeZone);

  // A wide-open day offered as three specific times is three arbitrary times.
  // Better to say it is open and ask what suits.
  const openness = opennessRatio(
    found.slots,
    openWindowFor(cfg.hours, cfg.timeZone, foundDate),
    service.durationMinutes
  );
  const mostlyFree = wants !== "earliest" && !hasPreference && openness >= 0.7;

  return {
    available: true,
    canCheck: true,
    // Every response carries the date, so the model can orient from the first
    // successful call rather than guessing and being corrected afterwards.
    today,
    date: foundDate,
    ...(movedOn ? { requestedDate: date } : {}),
    service: service.name,
    durationMinutes: service.durationMinutes,
    mostlyFree,
    options,
    message: mostlyFree
      ? `${movedOn ? `${dayPhrase} is` : "That day is"} wide open for ` +
        `${service.name.toLowerCase()} — say so and ask what time would suit ` +
        "them, rather than reading out times. If they have no preference, " +
        `the first one is ${options[0]?.time} with ${options[0]?.stylist}.`
      : wants === "earliest"
        ? `The soonest is ${dayPhrase} at ${options[0]?.time} with ` +
          `${options[0]?.stylist}` +
          (options[1]
            ? `, then ${options[1].time}. Offer the first and mention the ` +
              "second only if they hesitate."
            : ". Offer it.") +
          " Say the day as well as the time. Then call book_appointment with " +
          "the exact startsAt for whichever they take."
        : (movedOn
            ? `Nothing on the day they asked for, but ${dayPhrase} has: `
            : "Offer these times: ") +
          `${options
            .map((o) => `${o.time} with ${o.stylist}`)
            .join(", ")}. When the caller picks one, call book_appointment ` +
          "with the exact startsAt value for that option.",
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
        bookedService.unmatched
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
      console.warn("[VAPI FUNCTIONS] Stylist inference failed:", err);
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

  const today = zonedDateString(new Date(), cfg.timeZone);

  const clientType = normaliseClientType(
    params.clientType ??
      (params.newClient === true
        ? "new"
        : params.newClient === false
          ? "returning"
          : undefined)
  );

  // The rule the prompt states, enforced: colour needs to know. Treating
  // "unknown" as new is safe for the diary, but a regular who had colour
  // here last month was booked as new and told she needed a skin test.
  if (service.requiresPatchTest && clientType === "unknown") {
    return {
      success: false,
      needsClientType: true,
      message:
        `${service.name} is a colour service. Ask whether they have had colour here before, ` +
        "then book again with clientType 'returning' if they have, or 'new' if not.",
    };
  }

  // Re-apply the lead-time rules here as well as in availability. The model
  // can reach book_appointment without ever calling check_availability, and a
  // patch-test window is not something to enforce only on the happy path.
  const floor = earliestBookableStart(service, clientType, new Date(), undefined, undefined, cfg);
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

  const slotProblem = await phoneSlotProblem(provider, organizationId, cfg, startsAt, service, stylist, {
    clientType,
    offeredOnly: true,
  });
  if (slotProblem) {
    return { success: false, today, notAvailable: true, message: slotProblem };
  }

  // One number, one client record, but not always one person: a mum books
  // herself and her daughter on her own phone. The daughter goes on a record
  // of her own, reached through her mum's number (src/lib/client-link.ts).
  const { lead, contact } = await clientForBooking(organizationId, phone, clientName);
  const bookingNotes = blankToUndefined(notes);

  const needsSkinTest = service.requiresPatchTest && clientType !== "returning";

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
    usedCallerId: resolvedPhone.source === "callerId",
    patchTestRequired: needsSkinTest,
    message:
      `Booked: ${service.name} for ${clientName} with ${stylist.name} ${bookedWhen}. Confirm that ` +
      "in one sentence, without repeating what you said before booking" +
      (sms.ok ? ", and say a text is on its way." : ". Do NOT promise a text — one could not be sent.") +
      // A model left to explain the skin test invented one: "Jo will do it
      // as part of the colour appointment", which is the one thing it is not.
      (needsSkinTest
        ? " Also tell them, in one sentence: as a new colour client they need a quick skin " +
          "test at the salon at least 48 hours before, which is separate and which the salon " +
          "will be in touch to arrange."
        : "") +
      // They never said the number out loud, so they have not had the chance
      // to catch it being wrong — and the confirmation text has just gone to
      // it.
      // Told only "check it", a receptionist given a correction saved the new
      // number on the client's record and said "all updated", leaving the
      // booking (and its text) on the old one; another booked everything
      // again and left the first two in the diary.
      (resolvedPhone.source === "callerId"
        ? ` It was booked against the number they are ringing from, ` +
          `${speakablePhone(phone)} — read that back and check it is right. ` +
          "If it is wrong, the booking is on that number: cancel it and book it again on the right one."
        : ""),
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
      "Confirm that back to the caller" +
      (sms.ok ? " and say a text is coming." : ", but do not promise a text.") +
      " Offer to rebook if they want another time.",
  };
}

export async function handleRescheduleAppointment(
  organizationId: string,
  params: BookingLookup & {
    date?: string;
    day?: string;
    time: string;
    stylist?: string;
  }
) {

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
    const clock = parseSpokenTime(params.time);
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
  const clientType =
    appt.clientType === "returning" ? "returning" : appt.patchTestRequired ? "new" : "unknown";
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
  const slotProblem = await phoneSlotProblem(provider, organizationId, cfg, startsAt, service, stylist, {
    offeredOnly: false,
  });
  if (slotProblem) {
    return { success: false, notAvailable: true, message: slotProblem };
  }

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
      `Moved${appt.lead.name ? ` ${appt.lead.name}'s booking` : ""} to ${whenText} with ${stylist.name}. Confirm that back to the ` +
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
/**
 * Why a phone booking cannot go at `startsAt`, or null when it can.
 *
 * The diary write checks clashes and blocked time but not opening hours, on
 * purpose: the desk may book whatever it likes. The phone may not. Without
 * this, a stylist named and a time sent straight to book_appointment (no
 * check_availability first) put a cut in at 3am, and one running past
 * closing. So: the salon open that day, the whole service inside its hours,
 * the stylist in that day; and for a new booking, a time the diary would
 * actually offer, which also covers the stylist's own blocks and bookings.
 */
export async function phoneSlotProblem(
  provider: BookingProvider,
  organizationId: string,
  cfg: SalonConfig,
  startsAt: Date,
  service: SalonService,
  stylist: Stylist,
  opts: { clientType?: "new" | "returning" | "unknown"; offeredOnly: boolean }
): Promise<string | null> {
  const endsAt = new Date(startsAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000);
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
      console.warn("[VAPI FUNCTIONS] Slot check failed:", err);
    }
  }
  return null;
}

const DAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The handlers are written for strings; a model does not always send them.
 * `service: 123` crashed on `.trim()` rather than getting an answer. Numbers
 * become text, and null becomes absent, which every handler already treats
 * as "not given". Anything else is left for the handler's own checks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseParameters(parameters: Record<string, any> | null | undefined): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (value === null) continue;
    out[key] = typeof value === "number" ? String(value) : value;
  }
  return out;
}

/**
 * A refused booking says so first, whatever the reason. The reasons read as
 * next steps ("which stylist is that with?"), and after three of them in a
 * row one call answered the next "just book it" with "that's booked in".
 */
export function saysNotBooked<T>(result: T): T {
  const r = result as { success?: boolean; message?: unknown };
  if (r && r.success === false && typeof r.message === "string" && !r.message.startsWith("NOT booked")) {
    return { ...r, message: `NOT booked. ${r.message}` } as T;
  }
  return result;
}

export async function executeVapiFunction(
  name: string,
  organizationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any>
): Promise<unknown> {
  parameters = normaliseParameters(parameters);
  switch (name) {
    case "save_customer_details":
      return handleSaveCustomerDetails(organizationId, parameters as Parameters<typeof handleSaveCustomerDetails>[1]);
    case "book_callback":
      return handleBookCallback(organizationId, parameters as Parameters<typeof handleBookCallback>[1]);
    case "check_availability":
      return handleCheckAvailability(organizationId, parameters as Parameters<typeof handleCheckAvailability>[1]);
    case "book_appointment":
      return saysNotBooked(
        await handleBookAppointment(organizationId, parameters as Parameters<typeof handleBookAppointment>[1])
      );
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
