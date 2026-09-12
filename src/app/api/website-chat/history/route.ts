import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { corsHeaders, checkCORS } from "@/lib/website-chat";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Returns the transcript for one visitor's conversation so the widget can
 * restore it after a page navigation or reload.
 *
 * The iframe is destroyed on every navigation, and the sessionId lives in the
 * visitor's localStorage — so without this the visitor saw an empty panel and
 * a fresh greeting while the server kept appending to the same conversation.
 * The model then answered with context the visitor could no longer see.
 *
 * Access model: the sessionId is an unguessable v4 UUID held only by that
 * visitor's browser, so it acts as the bearer token for their own transcript.
 * It is always scoped together with siteId, and only role/content/timestamp
 * are returned — never lead details, visitor contact fields or internal ids.
 */

const MAX_MESSAGES = 100;

export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");
    const sessionId = searchParams.get("sessionId");

    if (!siteId || !sessionId) {
      return NextResponse.json(
        { error: "siteId and sessionId required" },
        { status: 400, headers }
      );
    }

    // Cheap guard against someone walking the sessionId space. Keyed on the
    // session rather than IP so one visitor reloading repeatedly can't be
    // blocked by a noisy neighbour behind the same NAT.
    const { allowed } = rateLimit("website-chat-history", sessionId, {
      tokens: 30,
      refillPerSecond: 1,
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
    // Matches the message and handoff endpoints. The sessionId is already an
    // unguessable bearer and lives in storage scoped to this origin, so this
    // is defence in depth rather than the primary control — but a transcript
    // endpoint should not be the one sibling that skips the check.
    if (!checkCORS(origin, site.allowedOrigins as string[])) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403, headers }
      );
    }

    // sessionId is globally unique, so the siteId here is a scoping check
    // rather than part of the lookup: a session belonging to another site
    // must not resolve through this one.
    const conversation = await prisma.websiteConversation.findFirst({
      where: { sessionId, siteId },
      select: { id: true, handoffState: true },
    });

    // No prior conversation is the normal first-visit case, not an error.
    if (!conversation) {
      return NextResponse.json(
        { messages: [], handoffState: "bot" },
        { headers }
      );
    }

    // Take the most recent slice, then restore chronological order — a long
    // transcript should keep its tail, not its head.
    const recent = await prisma.websiteMessage.findMany({
      where: { conversationId: conversation.id },
      select: { id: true, role: true, content: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_MESSAGES,
    });

    return NextResponse.json(
      { messages: recent.reverse(), handoffState: conversation.handoffState },
      { headers }
    );
  } catch (err) {
    console.error("[WEBSITE CHAT HISTORY] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
