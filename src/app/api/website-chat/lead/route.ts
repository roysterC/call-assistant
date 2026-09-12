import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkCORS, corsHeaders, isValidEmail } from "@/lib/website-chat";
import { rateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { upsertWebsiteLead } from "@/lib/website-lead";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    // Rate-limit lead captures per client IP. Tight limit — legitimate use
    // is at most one lead submission per session. Burst 5, refill 1 per 10s.
    const rl = rateLimit("website-chat-lead", clientIpFromHeaders(req.headers), {
      tokens: 5,
      refillPerSecond: 0.1,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterMs: rl.retryAfterMs },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 1000) / 1000)),
          },
        }
      );
    }

    const body = await req.json();
    const { siteId, sessionId, name, email, phone, notes } = body;

    if (!siteId || !sessionId || !email) {
      return NextResponse.json(
        { error: "siteId, sessionId, email required" },
        { status: 400, headers }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Invalid email" },
        { status: 400, headers }
      );
    }

    const site = await prisma.websiteConfig.findUnique({
      where: { siteId },
    });

    if (!site || !site.enabled) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 404, headers }
      );
    }

    if (!checkCORS(origin, site.allowedOrigins as string[])) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403, headers }
      );
    }

    const conversation = await prisma.websiteConversation.findUnique({
      where: { sessionId },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404, headers }
      );
    }

    const organizationId = site.organizationId;
    // Keyed on email, shared with the lead-marker path.
    //
    // This used to look the lead up by phone and, when the visitor gave none,
    // invent `website-{sessionId}` — so the same person filling the form again
    // next week became a second lead, because the session had changed. It also
    // never checked email at all, so someone who had already been captured by
    // the marker got a duplicate.
    const lead = await upsertWebsiteLead({
      organizationId,
      email,
      name,
      phone,
      notes,
    });

    await prisma.websiteConversation.update({
      where: { id: conversation.id },
      data: {
        leadId: lead.id,
        visitorName: name || undefined,
        visitorEmail: email,
        visitorPhone: phone || undefined,
      },
    });

    return NextResponse.json({ success: true, leadId: lead.id }, { headers });
  } catch (error) {
    console.error("[WEBSITE CHAT LEAD] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
