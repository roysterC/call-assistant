import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { corsHeaders, checkCORS } from "@/lib/website-chat";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Visitor asks to speak to a person.
 *
 * Flips the conversation out of bot mode and surfaces it in the operator's
 * inbox as unread. The bot stops answering from this point — a model talking
 * over someone who has explicitly asked for a human is the single most
 * irritating failure a chat widget has.
 */
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
    const body = await req.json();
    const { siteId, sessionId } = body ?? {};

    if (!siteId || !sessionId) {
      return NextResponse.json(
        { error: "siteId and sessionId required" },
        { status: 400, headers }
      );
    }

    const { allowed } = rateLimit("website-chat-handoff", sessionId, {
      tokens: 5,
      refillPerSecond: 0.1,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers }
      );
    }

    const site = await prisma.websiteConfig.findUnique({
      where: { siteId },
      select: { enabled: true, allowedOrigins: true },
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

    const conversation = await prisma.websiteConversation.findFirst({
      where: { sessionId, siteId },
      select: { id: true, handoffState: true },
    });
    if (!conversation) {
      return NextResponse.json(
        { error: "No conversation" },
        { status: 404, headers }
      );
    }

    // Already with a human — don't reset an in-progress handoff back to
    // "requested" or re-notify on a double tap.
    if (conversation.handoffState !== "bot") {
      return NextResponse.json(
        { handoffState: conversation.handoffState },
        { headers }
      );
    }

    await prisma.websiteConversation.update({
      where: { id: conversation.id },
      data: {
        handoffState: "requested",
        handoffRequestedAt: new Date(),
        // Unread is the notification: this is what pulls it to the top of the
        // operator's inbox, which already sorts and filters on it.
        isRead: false,
        lastMessageAt: new Date(),
      },
    });

    return NextResponse.json({ handoffState: "requested" }, { headers });
  } catch (err) {
    console.error("[WEBSITE CHAT HANDOFF] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
