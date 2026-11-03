import { prisma } from "@/lib/prisma";
import { canCreateBooking, getBookingProvider, getSalonConfig } from "@/lib/booking";
import { matchStylist } from "@/lib/salon-config";
import { normalisePhone, speakablePhone } from "@/lib/phone";
import { nameRequiredMessage, normaliseCallerName } from "@/lib/caller-name";
import { blankToUndefined, resolveCallerPhone } from "./action-helpers";

/**
 * Messages and call-backs: take_message for the stylist or the manager, and
 * book_callback for someone who wants the salon to ring them.
 */

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
        "[RECEPTIONIST] Callback calendar write failed:",
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

/**
 * One message from two tellings. The receptionist usually resends the whole
 * message with the new detail worked in, so a new version that repeats most
 * of the old one replaces it; a new detail on its own is added underneath.
 */
export function mergeMessage(before: string, next: string): string {
  if (!before.trim()) return next;
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9']+/g) ?? []);
  const old = words(before);
  const now = words(next);
  const kept = [...old].filter((w) => now.has(w)).length;
  return old.size > 0 && kept / old.size >= 0.6 ? next : `${before}\n${next}`;
}

/**
 * A message for the salon to ring the caller back: they asked for a person,
 * or for something the receptionist cannot do or answer.
 *
 * There is nobody to put a call through to, so this is what "can I speak to
 * someone?" becomes. It lands on the Callbacks page (and the counter beside
 * it in the menu), with the message as the callback's note. Unlike
 * `book_callback` it needs no date: it is listed by when the caller rang,
 * and the caller is never told a time, only that someone will ring back as
 * soon as they can.
 */
export async function handleTakeMessage(
  organizationId: string,
  params: {
    customerName?: string;
    customerPhone?: string;
    /** Caller ID, supplied by the tool body. */
    callerNumber?: string;
    message?: string;
    forStylist?: string;
  }
) {
  const parsedName = normaliseCallerName(params.customerName);
  if (!parsedName.ok) {
    return { success: false, missingName: true, message: nameRequiredMessage(parsedName.reason) };
  }
  const message = blankToUndefined(params.message);
  if (!message) {
    return {
      success: false,
      message: "What is the message? Ask what they would like the salon to ring about, then send it.",
    };
  }
  const phone = resolveCallerPhone(params.customerPhone, params.callerNumber);
  if (!phone.ok) {
    return {
      success: false,
      message: `${phone.reason} Ask for the best number to ring them back on, and read it back.`,
    };
  }

  const lead =
    (await prisma.lead.findUnique({
      where: { organizationId_phone: { organizationId, phone: phone.e164 } },
    })) ??
    (await prisma.lead.create({
      data: { organizationId, phone: phone.e164, name: parsedName.name, source: "phone" },
    }));

  const cfg = await getSalonConfig(organizationId);
  const stylist = matchStylist(blankToUndefined(params.forStylist), cfg.stylists);
  const now = new Date();

  // More detail from the same caller a moment later ("it's about my fringe")
  // is added to the message already taken, rather than filed as a second one.
  const recent = await prisma.callback.findFirst({
    where: {
      organizationId,
      leadId: lead.id,
      status: "pending",
      createdAt: { gte: new Date(now.getTime() - 30 * 60_000) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    await prisma.callback.update({
      where: { id: recent.id },
      data: {
        notes: mergeMessage(recent.notes ?? "", message),
        ...(stylist ? { assignedTo: stylist.name } : {}),
      },
    });
  } else {
    await prisma.callback.create({
      data: {
        organizationId,
        leadId: lead.id,
        assignedTo: stylist?.name ?? "Team",
        // No due time: the Callbacks page lists messages by when the caller
        // rang. The column is required, so it holds that same moment.
        scheduledAt: now,
        notes: message,
      },
    });
  }

  // The caller hears no time: "today" or "when we open" is a promise the salon
  // may not keep.
  return {
    success: true,
    message:
      `${recent ? "Added to their message" : "Message taken"} for ${stylist?.name ?? "the salon"}. ` +
      // On caller ID the number is the phone in their hand: reading it out
      // and asking whether it is right only added a turn.
      "In one sentence, tell the caller someone will ring them back as soon as they can" +
      (phone.source === "callerId"
        ? " on this number; do not read it out."
        : `, on ${speakablePhone(phone.e164)}.`) +
      " Never say when: not today, not tomorrow, not when the salon opens, no time at all. Do not say " +
      "anyone will be put through. If they tell you anything more about it, call take_message again " +
      "with the whole message, updated, before saying it is noted; otherwise nobody sees it.",
  };
}
