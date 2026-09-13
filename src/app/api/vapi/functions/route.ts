import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyVapiRequest,
  describeAuthHeaders,
} from "@/lib/vapi-signature";
import { rateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import {
  canCreateBooking,
  canReadAvailability,
  earliestBookableStart,
  getBookingProvider,
  getSalonConfig,
  summariseSlotsForSpeech,
} from "@/lib/booking";
import { matchService, matchStylist } from "@/lib/salon-config";
import {
  nextOpenMorning,
  parseDateOnly,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";

/**
 * Resolve the organization ID for a Vapi function call by inspecting the
 * call payload for a Vapi phone number ID or dialled number.
 */
async function resolveOrgFromVapiPayload(
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

// Vapi calls this endpoint when the AI assistant invokes a tool/function
// Supports both:
// 1. Server URL webhook format: { message: { type: "function-call", functionCall: { name, parameters } } }
// 2. API Request tool format: { message: { toolCallList: [{ function: { name, arguments } }] } }
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // This route writes to the salon's live diary and can trigger outbound
    // SMS, so it is verified exactly like the webhook route. Read the raw body
    // first — re-serialising a parsed object changes the bytes and breaks the
    // HMAC scheme.
    const verified = verifyVapiRequest(rawBody, req.headers);
    if (!verified.ok) {
      console.warn(
        `[VAPI] Rejected function call: ${verified.reason} | headers: ${describeAuthHeaders(req.headers)}`
      );
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Rate limit by client IP (post-signature — a caller needs a valid
    // signature to even count against the bucket). Matches the webhook route.
    const rl = rateLimit("vapi-functions", clientIpFromHeaders(req.headers), {
      tokens: 20,
      refillPerSecond: 2,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)),
          },
        }
      );
    }

    const body = JSON.parse(rawBody);

    // Log the parsed payload for debugging
    console.log("[VAPI] Received payload:", JSON.stringify(body, null, 2));

    let name: string | undefined;
    let parameters: Record<string, unknown> = {};
    let toolCallId: string | undefined;

    // Format 1: Server URL webhook (function-call type)
    if (body.message?.type === "function-call") {
      name = body.message.functionCall?.name;
      parameters = body.message.functionCall?.parameters || {};
      toolCallId = body.message.functionCall?.id;
    }
    // Format 2: API Request tool with toolCallList
    else if (body.message?.toolCallList) {
      const toolCall = body.message.toolCallList[0];
      name = toolCall?.function?.name;
      toolCallId = toolCall?.id;
      try {
        parameters = typeof toolCall?.function?.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall?.function?.arguments || {};
      } catch {
        parameters = {};
      }
    }
    // Format 3: API Request tool - direct tool call
    else if (body.message?.type === "tool-calls") {
      const toolCall = body.message.toolCallList?.[0] || body.message.toolCalls?.[0];
      name = toolCall?.function?.name;
      toolCallId = toolCall?.id;
      try {
        parameters = typeof toolCall?.function?.arguments === "string"
          ? JSON.parse(toolCall.function.arguments)
          : toolCall?.function?.arguments || {};
      } catch {
        parameters = {};
      }
    }

    if (!name) {
      console.log("[VAPI] Could not determine function name from payload");
      return NextResponse.json(
        { results: [{ result: JSON.stringify({ error: "Could not determine function name" }) }] },
        { status: 400 }
      );
    }

    console.log(`[VAPI] Executing function: ${name} with params:`, JSON.stringify(parameters));

    const organizationId = await resolveOrgFromVapiPayload(body);
    if (!organizationId) {
      console.warn("[VAPI] No org mapping for function call");
      return NextResponse.json(
        {
          results: [
            {
              result: JSON.stringify({
                error:
                  "No organization is mapped to this call. Map the Vapi phone number or the assistant id to an organization.",
              }),
            },
          ],
        },
        { status: 200 }
      );
    }

    const orgSettings = await prisma.organizationSettings.findUnique({
      where: { organizationId },
      select: { voiceEnabled: true },
    });
    if (!orgSettings?.voiceEnabled) {
      console.log(
        "[VAPI] voiceEnabled=false for org, rejecting function call:",
        organizationId
      );
      return NextResponse.json(
        { results: [{ result: JSON.stringify({ error: "Voice agent disabled" }) }] },
        { status: 200 }
      );
    }

    let result: unknown;

    switch (name) {
      case "save_customer_details":
        result = await handleSaveCustomerDetails(organizationId, parameters as {
          name?: string; email?: string; phone?: string;
          company?: string; businessType?: string; issue?: string;
        });
        break;
      case "book_callback":
        result = await handleBookCallback(organizationId, parameters as {
          date: string; time?: string; assignedTo?: string;
          notes?: string; customerPhone: string; customerName?: string;
        });
        break;
      case "check_availability":
        result = await handleCheckAvailability(organizationId, parameters as {
          date: string; service?: string; stylist?: string;
          teamMember?: string; clientType?: string;
        });
        break;
      case "book_appointment":
        result = await handleBookAppointment(organizationId, parameters as {
          date: string; time: string; service: string; stylist?: string;
          customerPhone: string; customerName?: string;
          clientType?: string; notes?: string;
        });
        break;
      case "transfer_call":
        result = await handleTransferCall(organizationId, parameters as {
          teamMember?: string; reason?: string;
        });
        break;
      default:
        result = { error: `Unknown function: ${name}` };
    }

    console.log(`[VAPI] Function ${name} result:`, JSON.stringify(result));

    // Vapi expects results with toolCallId for matching
    const responseItem: { toolCallId?: string; result: string } = {
      result: JSON.stringify(result),
    };
    if (toolCallId) {
      responseItem.toolCallId = toolCallId;
    }

    return NextResponse.json({ results: [responseItem] });
  } catch (error) {
    console.error("[VAPI] Function call error:", error);
    return NextResponse.json(
      { results: [{ result: JSON.stringify({ error: "Function execution failed" }) }] },
      { status: 200 }
    );
  }
}

async function handleSaveCustomerDetails(
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

  if (!phone) {
    return { success: false, message: "Phone number is required" };
  }

  const lead = await prisma.lead.upsert({
    where: { organizationId_phone: { organizationId, phone } },
    update: {
      ...(name && { name }),
      ...(email && { email }),
      ...(company && { company }),
      ...(issue && { issue }),
    },
    create: {
      organizationId,
      phone,
      name: name || null,
      email: email || null,
      company: company || null,
      issue: businessType ? `[${businessType}] ${issue || ""}`.trim() : issue || null,
      source: "phone",
    },
  });

  return {
    success: true,
    message: `Customer details saved for ${lead.name || lead.phone}`,
    leadId: lead.id,
  };
}

async function handleBookCallback(
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

  let lead = await prisma.lead.findUnique({
    where: { organizationId_phone: { organizationId, phone: customerPhone } },
  });

  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        organizationId,
        phone: customerPhone,
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

function normaliseClientType(
  raw: string | undefined
): "new" | "returning" | "unknown" {
  const v = (raw ?? "").trim().toLowerCase();
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

async function handleCheckAvailability(
  organizationId: string,
  params: {
    date: string;
    service?: string;
    stylist?: string;
    teamMember?: string;
    clientType?: string;
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
  const service = matchService(params.service, cfg.services);

  if (!service) {
    return {
      available: null,
      canCheck: true,
      message:
        "Which service is that for? I need to know before I can check the " +
        "diary, because different services take different amounts of time.",
    };
  }

  const clientType = normaliseClientType(params.clientType);
  const stylistName = params.stylist || params.teamMember;

  let slots;
  try {
    slots = await provider.getAvailability({
      organizationId,
      date: params.date,
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
      message:
        "Nothing free on that date for that service. Offer to try another day.",
    };
  }

  const picked = summariseSlotsForSpeech(slots, 3);
  const options = picked.map((s) => ({
    time: spokenTime(s.start, cfg.timeZone),
    startsAt: s.start,
    stylist: s.stylistName,
  }));

  return {
    available: true,
    canCheck: true,
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

async function handleBookAppointment(
  organizationId: string,
  params: {
    date: string;
    time: string;
    service: string;
    stylist?: string;
    customerPhone: string;
    customerName?: string;
    clientType?: string;
    notes?: string;
  }
) {
  const { date, time, customerPhone, customerName, notes } = params;

  if (!customerPhone) {
    return { success: false, message: "A phone number is required to book." };
  }

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

  const stylist = matchStylist(params.stylist, cfg.stylists);
  if (!stylist) {
    return {
      success: false,
      message:
        "Which stylist is that with? I need to know before I can put it in " +
        "the diary.",
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
    const d = parseDateOnly(date);
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

  const clientType = normaliseClientType(params.clientType);

  // Re-apply the lead-time rules here as well as in availability. The model
  // can reach book_appointment without ever calling check_availability, and a
  // patch-test window is not something to enforce only on the happy path.
  const floor = earliestBookableStart(service, clientType, new Date());
  if (startsAt < floor.at) {
    return {
      success: false,
      tooSoon: true,
      patchTestRequired: floor.reason === "patch_test",
      message:
        floor.reason === "patch_test"
          ? `${service.name} needs a skin patch test at least 48 hours beforehand for a new client. Explain that and offer a later date.`
          : "That is too soon. Offer a later time.",
    };
  }

  const lead = await prisma.lead.upsert({
    where: { organizationId_phone: { organizationId, phone: customerPhone } },
    update: { ...(customerName && { name: customerName }) },
    create: {
      organizationId,
      phone: customerPhone,
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
    clientName: lead.name || customerPhone,
    clientPhone: customerPhone,
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
    startsAt: written.startsAt,
    stylist: stylist.name,
    service: service.name,
    message:
      `Booked: ${service.name} with ${stylist.name} at ` +
      `${spokenTime(written.startsAt, cfg.timeZone)}. Confirm that back to the ` +
      "caller and let them know they will get a text.",
  };
}

async function handleTransferCall(
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
