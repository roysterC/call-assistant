import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bookCallback, getAvailableSlots } from "@/lib/calendar";

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

  return null;
}

// Vapi calls this endpoint when the AI assistant invokes a tool/function
// Supports both:
// 1. Server URL webhook format: { message: { type: "function-call", functionCall: { name, parameters } } }
// 2. API Request tool format: { message: { toolCallList: [{ function: { name, arguments } }] } }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Log the raw payload for debugging
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
    // Format 4: Direct parameters (some API Request tool configs)
    else if (body.name || body.phone || body.date) {
      if (body.phone && !body.date) {
        name = "save_customer_details";
        parameters = body;
      } else if (body.date && body.customerPhone) {
        name = "book_callback";
        parameters = body;
      } else if (body.date) {
        name = "check_availability";
        parameters = body;
      }
    }
    // Format 5: Wrapped in a "tool_call" key
    else if (body.tool_call) {
      name = body.tool_call.name || body.tool_call.function?.name;
      toolCallId = body.tool_call.id;
      parameters = body.tool_call.parameters || body.tool_call.function?.arguments || {};
      if (typeof parameters === "string") {
        try { parameters = JSON.parse(parameters); } catch { parameters = {}; }
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
        { results: [{ result: JSON.stringify({ error: "Organization not configured for this phone number" }) }] },
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
          date: string; teamMember?: string;
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

  const booking = await bookCallback(
    scheduledAt.toISOString(),
    lead.name || lead.phone,
    lead.phone,
    teamMember,
    notes,
    lead.email,
    organizationId
  );

  if (!booking.success) {
    return { success: false, message: booking.error || "Failed to book callback" };
  }
  if (booking.warning) {
    console.warn("[VAPI FUNCTIONS] bookCallback warning:", booking.warning);
  }

  await prisma.callback.create({
    data: {
      organizationId,
      leadId: lead.id,
      assignedTo: teamMember,
      scheduledAt,
      notes: notes || null,
      calendarEventId: booking.eventId || null,
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

async function handleCheckAvailability(
  organizationId: string,
  params: { date: string; teamMember?: string }
) {
  const slots = await getAvailableSlots(params.date, params.teamMember, organizationId);
  const available = slots.filter((s) => s.available);

  if (available.length === 0) {
    return {
      available: false,
      message: "No available slots on that date. Would you like to try another day?",
    };
  }

  const formatted = available.slice(0, 6).map((s) => {
    const d = new Date(s.start);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  });

  return {
    available: true,
    slots: formatted,
    message: `Available times: ${formatted.join(", ")}`,
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
