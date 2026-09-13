import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyVapiRequest,
  describeAuthHeaders,
} from "@/lib/vapi-signature";
import { rateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { executeVapiFunction, isVapiFunctionName } from "@/lib/vapi-functions";

/**
 * Entry point for Vapi "API Request" tools.
 *
 * That tool type posts only the body template you configure in the console —
 * no envelope, no function name, and no call object. So neither the function
 * nor the tenant can be read from the body, and guessing either from the shape
 * of the parameters is exactly the unreliable behaviour that was removed from
 * the envelope route. Both therefore come from the URL:
 *
 *   POST /api/vapi/functions/shogo/check_availability
 *        { "date": "2026-09-17", "service": "Cut and finish" }
 *
 * Vapi's Function/Server tool type sends the full envelope instead and should
 * use the parent route; this exists so either tool type works.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ org: string; name: string }> }
) {
  try {
    const rawBody = await req.text();

    const verified = verifyVapiRequest(rawBody, req.headers);
    if (!verified.ok) {
      console.warn(
        `[VAPI] Rejected tool call: ${verified.reason} | headers: ${describeAuthHeaders(req.headers)}`
      );
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

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

    const { org: orgSlug, name } = await params;

    if (!isVapiFunctionName(name)) {
      console.warn(`[VAPI] Unknown function in path: ${name}`);
      return NextResponse.json(
        { error: `Unknown function: ${name}` },
        { status: 404 }
      );
    }

    const organization = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, enabled: true },
    });
    if (!organization || !organization.enabled) {
      console.warn(`[VAPI] No enabled organization for slug: ${orgSlug}`);
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: organization.id },
      select: { voiceEnabled: true },
    });
    if (!settings?.voiceEnabled) {
      return NextResponse.json(
        { results: [{ result: JSON.stringify({ error: "Voice agent disabled" }) }] },
        { status: 200 }
      );
    }

    // The body IS the parameters. An empty body is valid for a tool that takes
    // none, so parse leniently rather than rejecting.
    let parameters: Record<string, unknown> = {};
    if (rawBody.trim()) {
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parameters = parsed as Record<string, unknown>;
        }
      } catch {
        return NextResponse.json(
          { error: "Body was not valid JSON" },
          { status: 400 }
        );
      }
    }

    console.log(
      `[VAPI] ${orgSlug}/${name} with:`,
      JSON.stringify(parameters)
    );

    const result = await executeVapiFunction(name, organization.id, parameters);

    console.log(`[VAPI] ${name} result:`, JSON.stringify(result));

    // Return the bare result. An API Request tool has no toolCallId to echo,
    // and Vapi hands the response body to the model as-is.
    return NextResponse.json(result);
  } catch (error) {
    console.error("[VAPI] Tool call error:", error);
    return NextResponse.json(
      { error: "Function execution failed" },
      { status: 200 }
    );
  }
}
