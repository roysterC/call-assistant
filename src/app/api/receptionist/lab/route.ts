/**
 * The receptionist lab: talk to our own receptionist by typing.
 *
 * Owner and super-admin only. It runs against the salon's real diary — that is
 * the point of testing it — so a booking made here is a real booking, and
 * stylist and member logins are kept out.
 *
 *   POST { callerNumber? }                 start a conversation, get the greeting
 *   POST { sessionId, message }            say something, get the reply
 *   DELETE ?sessionId=…                    hang up
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";
import { receptionistApiKey, startReceptionist } from "@/lib/receptionist/session";
import { endLabSession, getLabSession, putLabSession } from "@/lib/receptionist/lab-store";

async function labContext(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  if (!ctx.isSuperAdmin && ctx.role !== "admin" && ctx.role !== "superAdmin") {
    return NextResponse.json({ error: "Only the salon's owner can use the lab." }, { status: 403 });
  }
  return ctx;
}

export async function POST(req: NextRequest) {
  const ctx = await labContext(req);
  if (isErrorResponse(ctx)) return ctx;

  if (!(await receptionistApiKey(ctx.organizationId))) {
    return NextResponse.json(
      {
        error:
          "No Anthropic API key: set one for this salon (Admin → Organizations) or ANTHROPIC_API_KEY on the server.",
      },
      { status: 503 }
    );
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as {
    sessionId?: unknown;
    message?: unknown;
    callerNumber?: unknown;
  };

  // --- Start a conversation -------------------------------------------------
  if (typeof body.sessionId !== "string") {
    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { voiceEnabled: true },
    });
    if (!settings?.voiceEnabled) {
      return NextResponse.json({ error: "The voice agent is switched off for this salon." }, { status: 409 });
    }

    // Blank means "withheld", which is worth testing too.
    let callerNumber: string | null = null;
    if (typeof body.callerNumber === "string" && body.callerNumber.trim()) {
      const parsed = normalisePhone(body.callerNumber);
      if (!parsed.ok) {
        return NextResponse.json({ error: `That caller number won't work: ${parsed.reason}` }, { status: 400 });
      }
      callerNumber = parsed.e164;
    }

    const session = await startReceptionist(ctx.organizationId, { callerNumber });
    const sessionId = putLabSession(session, ctx.organizationId, ctx.userId);
    return NextResponse.json({
      sessionId,
      greeting: session.greeting,
      model: session.model,
      keySource: session.keySource,
      tools: session.toolNames,
      callerNumber,
    });
  }

  // --- A caller turn --------------------------------------------------------
  const entry = getLabSession(body.sessionId, ctx.organizationId, ctx.userId);
  if (!entry) {
    return NextResponse.json({ error: "That conversation has ended. Start a new one." }, { status: 404 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Say something first." }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "That's longer than anyone says in one go on the phone." }, { status: 400 });
  }
  if (entry.busy) {
    return NextResponse.json({ error: "Still answering the last message." }, { status: 409 });
  }

  entry.busy = true;
  const started = Date.now();
  let firstTextMs: number | null = null;
  try {
    const turn = await entry.session.engine.respond(message, {
      onText: () => {
        if (firstTextMs === null) firstTextMs = Date.now() - started;
      },
    });
    return NextResponse.json({
      reply: turn.text,
      tools: turn.tools,
      stopReason: turn.stopReason,
      usage: turn.usage,
      // How long until the first word, which is what a caller feels, and
      // until the whole reply.
      firstTextMs,
      totalMs: Date.now() - started,
    });
  } catch (err) {
    console.error("[RECEPTIONIST LAB] turn failed:", err);
    const detail =
      err instanceof Anthropic.AuthenticationError
        ? "The Anthropic API key was rejected."
        : err instanceof Anthropic.RateLimitError
          ? "Rate limited by the model provider. Try again in a moment."
          : err instanceof Anthropic.APIError
            ? `Model error ${err.status}.`
            : "Something went wrong running that turn.";
    return NextResponse.json({ error: detail }, { status: 502 });
  } finally {
    entry.busy = false;
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await labContext(req);
  if (isErrorResponse(ctx)) return ctx;
  const id = req.nextUrl.searchParams.get("sessionId");
  if (id && getLabSession(id, ctx.organizationId, ctx.userId)) endLabSession(id);
  return NextResponse.json({ ok: true });
}
