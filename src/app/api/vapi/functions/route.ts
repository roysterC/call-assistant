import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyVapiRequest,
  describeAuthHeaders,
} from "@/lib/vapi-signature";
import { rateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import {
  summariseAvailabilityCall,
  telemetryLine,
} from "@/lib/voice-telemetry";
import {
  executeVapiFunction,
  resolveOrgFromVapiPayload,
} from "@/lib/vapi-functions";


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

    const result = await executeVapiFunction(
      name,
      organizationId,
      parameters
    );

    console.log(`[VAPI] Function ${name} result:`, JSON.stringify(result));

    // One structured line per availability check, so the forward-search
    // settings can be tuned from real calls. Carries no personal data;
    // never allowed to fail the call it is describing.
    if (name === "check_availability") {
      try {
        const t = summariseAvailabilityCall(
          parameters,
          result as Record<string, unknown>
        );
        if (t) console.log(telemetryLine(t));
      } catch {
        // Telemetry is never worth a dropped booking.
      }
    }

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

