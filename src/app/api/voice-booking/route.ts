/**
 * Booking by voice, from the diary.
 *
 *   POST { text, sessionId? }                     what was said (or typed)
 *   POST { sessionId, action: "save" | "discard" } the buttons on the card
 *   DELETE ?sessionId=                            finished
 *
 * A card on screen is saved only here, by plain code: the Save button, or a
 * short, plain "yes" (see confirm.ts). Everything else goes to the assistant,
 * which can look things up and draw a new card but cannot save one.
 *
 * Owners and stylists alike: a stylist books into their own column only,
 * the same as typing a booking in.
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireTenant, isErrorResponse, type TenantContext } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { getSalonConfig } from "@/lib/booking";
import { receptionistApiKey } from "@/lib/receptionist/session";
import { answerTo } from "@/lib/voice-booking/confirm";
import { commitDraft, type Draft } from "@/lib/voice-booking/drafts";
import {
  describeDraft,
  endSession,
  findSession,
  keepSession,
  startVoiceBooking,
  type VoiceBookingSession,
} from "@/lib/voice-booking/assistant";
import { recordUsage } from "@/lib/usage/record";
import { fakeBookingModel } from "@/lib/voice-booking/fake-model";

type Body = { text?: unknown; sessionId?: unknown; action?: unknown };

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { stylists: true });
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  let session = findSession(sessionId, ctx.organizationId, ctx.userId);

  // --- The buttons ------------------------------------------------------------------
  if (body.action === "save" || body.action === "discard") {
    if (!session?.pending) return NextResponse.json({ error: "There is nothing waiting to be saved." }, { status: 409 });
    return body.action === "save" ? save(session) : NextResponse.json(discard(session));
  }

  // --- Something said -----------------------------------------------------------------
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Say something first." }, { status: 400 });
  if (text.length > 1000) return NextResponse.json({ error: "That is longer than a booking needs." }, { status: 400 });

  // A card is waiting and the answer is a plain yes or no: settled here.
  if (session?.pending) {
    const answer = answerTo(text);
    if (answer === "yes") return save(session);
    if (answer === "no") return NextResponse.json(discard(session));
  }

  if (!session) {
    const fake = process.env.VOICE_BOOKING_FAKE_MODEL === "1" && process.env.NODE_ENV !== "production";
    if (!fake && !(await receptionistApiKey(ctx.organizationId))) {
      return NextResponse.json(
        { error: "No Anthropic API key: set one for this salon (Admin → Organizations) or ANTHROPIC_API_KEY on the server." },
        { status: 503 }
      );
    }
    session = await startVoiceBooking(ctx, ctx.userId, {
      speaker: await speakerName(ctx),
      client: fake ? fakeBookingModel() : undefined,
    });
    keepSession(session);
  }
  if (session.busy) return NextResponse.json({ error: "Still working on the last one." }, { status: 409 });

  session.busy = true;
  const started = Date.now();
  try {
    const before = session.pending?.id;
    const turn = await session.engine.respond(text);
    void recordUsage(ctx.organizationId, {
      source: "desk_voice",
      sessionKey: session.id,
      startedAt: new Date(started),
      counts: {
        model: session.model,
        inputTokens: turn.usage.input,
        outputTokens: turn.usage.output,
        cacheReadTokens: turn.usage.cacheRead,
        cacheWriteTokens: turn.usage.cacheWrite,
      },
    });
    return NextResponse.json({
      sessionId: session.id,
      reply: turn.text,
      draft: await view(session),
      // A new card this turn, so the screen can draw attention to it.
      newDraft: Boolean(session.pending && session.pending.id !== before),
    });
  } catch (err) {
    console.error("[VOICE BOOKING] turn failed:", err);
    const detail =
      err instanceof Anthropic.AuthenticationError
        ? "The Anthropic API key was rejected."
        : err instanceof Anthropic.RateLimitError
          ? "Busy just now. Try again in a moment."
          : "Something went wrong. Try again, or book it by hand.";
    return NextResponse.json({ error: detail, sessionId: session.id }, { status: 502 });
  } finally {
    session.busy = false;
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireTenant(req, { stylists: true });
  if (isErrorResponse(ctx)) return ctx;
  const id = req.nextUrl.searchParams.get("sessionId") ?? undefined;
  if (findSession(id, ctx.organizationId, ctx.userId)) endSession(id!);
  return NextResponse.json({ ok: true });
}

// --- Helpers ------------------------------------------------------------------------------

async function save(session: VoiceBookingSession) {
  const draft = session.pending!;
  const result = await commitDraft(session.asker, draft);
  if (!result.ok) {
    // The card stays: the person can change it and try again.
    return NextResponse.json({ sessionId: session.id, saved: false, reply: result.message, draft: await view(session) });
  }
  session.pending = null;
  // The assistant hears how it ended, so "and book her again next month" follows on.
  remember(session, `[Saved: ${describeDraft(draft, await timeZone(session))}.]`, done(draft));
  return NextResponse.json({
    sessionId: session.id,
    saved: true,
    reply: done(draft),
    result,
    draft: null,
  });
}

function discard(session: VoiceBookingSession) {
  session.pending = null;
  remember(session, "[They said no; nothing was saved.]", "Okay, not saved.");
  return { sessionId: session.id, saved: false, reply: "Okay, not saved.", draft: null };
}

function done(d: Draft): string {
  return d.kind === "book" ? "Booked." : d.kind === "move" ? "Moved." : "Cancelled.";
}

/** Keep the history in turns: a user line, then the assistant's answer. */
function remember(session: VoiceBookingSession, userNote: string, reply: string) {
  const m = session.engine.messages;
  if (m.length === 0) return;
  m.push({ role: "user", content: userNote }, { role: "assistant", content: reply });
}

async function timeZone(session: VoiceBookingSession): Promise<string> {
  return (await getSalonConfig(session.asker.organizationId)).timeZone;
}

/** The card, as the screen shows it. */
async function view(session: VoiceBookingSession) {
  const d = session.pending;
  if (!d) return null;
  const tz = await timeZone(session);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  return {
    id: d.id,
    kind: d.kind,
    clientName: d.clientName,
    service: d.service,
    stylist: d.stylist,
    date: new Date(d.startsAt).toLocaleDateString("en-CA", { timeZone: tz }),
    day: day(d.startsAt),
    time: `${time(d.startsAt)} to ${time(d.endsAt)}`,
    newClient: d.kind === "book" && !d.leadId,
    phone: d.kind === "book" ? d.newClient?.phone ?? null : null,
    skinTest: d.kind === "book" && d.patchTestRequired,
    notes: d.kind === "book" ? d.notes : null,
    from: d.kind === "move" ? { day: day(d.from.startsAt), time: time(d.from.startsAt), stylist: d.from.stylist } : null,
  };
}

async function speakerName(ctx: TenantContext): Promise<string> {
  if (ctx.stylist) return `${ctx.stylist.name} (a stylist)`;
  const u = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  return `${u?.name ?? "the owner"} (full access)`;
}
