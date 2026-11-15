/**
 * Callbacks: people waiting for the salon to ring them back, and what came
 * of it.
 *
 * GET  ?view=todo (default) the ones waiting, longest first; ?view=done the
 *      last fortnight's, newest first; ?count=1 just the number waiting, for
 *      the menu's counter. Each comes with enough about the client to ring
 *      ready: when they were last in, what they usually have, what is next,
 *      and the chat it was left in, if it was.
 * PATCH { id, action }:
 *      "done" with an outcome (booked | sorted | not_needed) and an optional
 *      note; "no_answer" counts a try and keeps it waiting; "undo" puts a
 *      done one back. The older { id, status, outcome, notes } still works.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { summaryJson, visitSummaries } from "@/lib/client-summary";
import { readCouldNotBook } from "@/lib/callback-notes";
import { getSalonConfig } from "@/lib/booking";

const DONE_DAYS = 14;
const CHAT_CHANNELS = new Set(["whatsapp", "instagram", "facebook", "website"]);

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);

    // The menu's red counter: just the number waiting, polled every minute.
    if (searchParams.get("count") === "1") {
      const pending = await prisma.callback.count({
        where: { status: "pending", organizationId: ctx.organizationId },
      });
      return NextResponse.json({ pending });
    }

    const status = searchParams.get("status");
    const view = searchParams.get("view") ?? (status && status !== "pending" ? "done" : "todo");
    const now = new Date();
    const where: Prisma.CallbackWhereInput =
      view === "done"
        ? {
            organizationId: ctx.organizationId,
            status: { in: ["completed", "missed"] },
            updatedAt: { gte: new Date(now.getTime() - DONE_DAYS * 86_400_000) },
          }
        : { organizationId: ctx.organizationId, status: "pending" };

    const rows = await prisma.callback.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            notes: true,
            anonymisedAt: true,
            contactLead: { select: { name: true, phone: true } },
          },
        },
      },
      // Waiting ones by who has waited longest; done ones newest first.
      orderBy: view === "done" ? { updatedAt: "desc" } : { createdAt: "asc" },
      take: 200,
    });

    const leadIds = [...new Set(rows.map((r) => r.leadId))];
    const cfg = await getSalonConfig(ctx.organizationId);
    const [summaries, wa, social] = await Promise.all([
      visitSummaries(ctx.organizationId, leadIds, now, cfg),
      prisma.whatsAppConversation.findMany({
        where: { organizationId: ctx.organizationId, leadId: { in: leadIds } },
        select: { id: true, leadId: true, lastMessageAt: true },
      }),
      prisma.socialConversation.findMany({
        where: { organizationId: ctx.organizationId, leadId: { in: leadIds } },
        select: { id: true, leadId: true, channel: true, lastMessageAt: true },
      }),
    ]);

    // Their latest chat, for "Message": the one the callback came from when known.
    const latestChat = new Map<string, { channel: string; id: string; at: number }>();
    for (const c of [...wa.map((w) => ({ ...w, channel: "whatsapp" })), ...social]) {
      if (!c.leadId) continue;
      const at = c.lastMessageAt.getTime();
      const had = latestChat.get(c.leadId);
      if (!had || at > had.at) latestChat.set(c.leadId, { channel: c.channel, id: c.id, at });
    }

    const callbacks = rows.map((cb) => {
      const couldNotBook = readCouldNotBook(cb.notes);
      const fromChat = cb.channel && CHAT_CHANNELS.has(cb.channel) && cb.conversationId;
      const chat = fromChat
        ? { channel: cb.channel!, id: cb.conversationId! }
        : (() => {
            const c = latestChat.get(cb.leadId);
            return c ? { channel: c.channel, id: c.id } : null;
          })();
      const summary = summaries.get(cb.leadId);
      return {
        id: cb.id,
        status: cb.status,
        outcome: cb.outcome,
        createdAt: cb.createdAt,
        updatedAt: cb.updatedAt,
        completedAt: cb.completedAt,
        assignedTo: cb.assignedTo,
        message: couldNotBook ? couldNotBook.rest : cb.notes,
        couldNotBook: couldNotBook && {
          reason: couldNotBook.reason,
          service: couldNotBook.service,
          stylist: couldNotBook.stylist,
          startsAt: couldNotBook.startsAt,
        },
        attempts: cb.attempts,
        lastAttemptAt: cb.lastAttemptAt,
        handledBy: cb.handledBy,
        resultNote: cb.resultNote,
        // Unknown on messages left before it was kept.
        channel: cb.channel,
        chat,
        lead: {
          id: cb.lead.id,
          name: cb.lead.anonymisedAt ? null : cb.lead.name,
          phone: cb.lead.anonymisedAt ? null : cb.lead.phone,
          notes: cb.lead.anonymisedAt ? null : cb.lead.notes,
          contact: cb.lead.contactLead,
        },
        client: summary ? summaryJson(summary) : null,
      };
    });

    return NextResponse.json({ callbacks, timeZone: cfg.timeZone });
  } catch (error) {
    console.error("[CALLBACKS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** How a callback can end. The last five are the older page's, still accepted. */
const VALID_OUTCOMES = [
  "booked",
  "sorted",
  "not_needed",
  "converted",
  "no_answer",
  "not_interested",
  "follow_up",
  "other",
];
const DONE_OUTCOMES = ["booked", "sorted", "not_needed"];
const NOTE_MAX = 1000;

export async function PATCH(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const { id, action, status, outcome, notes, completedAt } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (outcome !== undefined && outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${VALID_OUTCOMES.join(", ")}` },
        { status: 400 }
      );
    }

    const existing = await prisma.callback.findUnique({
      where: { id },
      select: { organizationId: true, attempts: true },
    });
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const who = async () => {
      const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }).catch(() => null);
      return user?.name?.trim() || null;
    };
    const note = typeof body.note === "string" ? body.note.trim().slice(0, NOTE_MAX) || null : null;
    const now = new Date();
    let data: Prisma.CallbackUncheckedUpdateInput;

    if (action === "done") {
      if (!DONE_OUTCOMES.includes(outcome)) {
        return NextResponse.json({ error: `outcome must be one of: ${DONE_OUTCOMES.join(", ")}` }, { status: 400 });
      }
      data = { status: "completed", outcome, completedAt: now, handledBy: await who(), resultNote: note };
    } else if (action === "no_answer") {
      data = { attempts: existing.attempts + 1, lastAttemptAt: now, ...(note ? { resultNote: note } : {}) };
    } else if (action === "undo") {
      data = { status: "pending", outcome: null, completedAt: null, handledBy: null, resultNote: null };
    } else if (action !== undefined) {
      return NextResponse.json({ error: "action must be done, no_answer or undo" }, { status: 400 });
    } else {
      data = {};
      if (status !== undefined) data.status = status;
      if (outcome !== undefined) data.outcome = outcome;
      if (notes !== undefined) data.notes = notes;
      if (completedAt !== undefined) {
        data.completedAt = completedAt === null ? null : new Date(completedAt);
      }
      // Auto-stamp completedAt (and who) when marked completed without one supplied
      if (status === "completed" && completedAt === undefined) {
        data.completedAt = now;
        data.handledBy = await who();
      }
      if (Object.keys(data).length === 0) {
        return NextResponse.json(
          { error: "at least one of action, status, outcome, notes, completedAt is required" },
          { status: 400 }
        );
      }
    }

    const callback = await prisma.callback.update({ where: { id }, data });
    return NextResponse.json({ callback });
  } catch (error) {
    console.error("[CALLBACKS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
