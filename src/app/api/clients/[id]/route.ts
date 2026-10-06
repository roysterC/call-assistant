/**
 * One client, for the Clients page: who they are, their bookings, their
 * notes and their patch test; and changing those at the desk.
 *
 * Changing how a client is reached:
 *
 * A client reached through someone else's number (a child booked on a
 * parent's phone) can be given a number of their own, after which their
 * texts go to it; and, once they have one, unlinked from the parent's, so a
 * call from that number no longer manages their bookings. Unlinking a client
 * with no number of their own is refused: nobody could then text them or
 * find their bookings by phone.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { normalisePhone } from "@/lib/phone";
import { getSalonConfig } from "@/lib/booking";
import { parsePatchTestDate, patchTestDay } from "@/lib/patch-test";

/** Long enough for years of a regular's notes; short enough to refuse a paste of a file. */
const NOTES_MAX = 10_000;

/** How many bookings the page shows, newest first. */
const HISTORY_MAX = 100;

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const client = await prisma.lead.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        notes: true,
        patchTestAt: true,
        createdAt: true,
        contactLead: { select: { id: true, name: true, phone: true } },
        dependents: { select: { id: true, name: true } },
      },
    });
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [appointments, cfg] = await Promise.all([
      prisma.appointment.findMany({
        where: { organizationId: ctx.organizationId, leadId: id },
        orderBy: { startsAt: "desc" },
        take: HISTORY_MAX,
        select: {
          id: true,
          bookingNumber: true,
          startsAt: true,
          endsAt: true,
          serviceText: true,
          stylistName: true,
          status: true,
          amountMinor: true,
          patchTestRequired: true,
          confirmationSentAt: true,
          confirmationError: true,
        },
      }),
      getSalonConfig(ctx.organizationId),
    ]);

    return NextResponse.json({
      client: { ...client, patchTestAt: patchTestDay(client.patchTestAt) },
      appointments,
      timeZone: cfg.timeZone,
    });
  } catch (error) {
    console.error("[CLIENTS API] GET one error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) ?? {};

    const client = await prisma.lead.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, phone: true, contactLeadId: true },
    });
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: {
      phone?: string;
      contactLeadId?: null;
      notes?: string | null;
      patchTestAt?: Date | null;
    } = {};

    if (body.notes !== undefined) {
      if (body.notes !== null && typeof body.notes !== "string") {
        return NextResponse.json({ error: "Notes must be text." }, { status: 400 });
      }
      const notes = body.notes?.trim() || null;
      if (notes && notes.length > NOTES_MAX) {
        return NextResponse.json({ error: "Those notes are too long." }, { status: 400 });
      }
      data.notes = notes;
    }

    if (body.patchTestAt !== undefined) {
      const parsed = parsePatchTestDate(body.patchTestAt);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      data.patchTestAt = parsed.value;
    }

    if (typeof body.phone === "string" && body.phone.trim()) {
      const parsed = normalisePhone(body.phone);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: `That number does not look right: ${parsed.reason}` },
          { status: 400 }
        );
      }
      const taken = await prisma.lead.findFirst({
        where: { organizationId: ctx.organizationId, phone: parsed.e164, id: { not: id } },
        select: { name: true },
      });
      if (taken) {
        return NextResponse.json(
          { error: `${taken.name ?? "Another client"} already has that number.` },
          { status: 409 }
        );
      }
      data.phone = parsed.e164;
    }

    if (body.unlink === true && client.contactLeadId) {
      if (!(data.phone ?? client.phone)) {
        return NextResponse.json(
          { error: "Give them a number of their own before unlinking, or nobody can text them." },
          { status: 400 }
        );
      }
      data.contactLeadId = null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const updated = await prisma.lead.update({
      where: { id },
      data,
      select: {
        id: true,
        phone: true,
        notes: true,
        patchTestAt: true,
        contactLead: { select: { id: true, name: true, phone: true } },
      },
    });
    return NextResponse.json({
      client: { ...updated, patchTestAt: patchTestDay(updated.patchTestAt) },
    });
  } catch (error) {
    console.error("[CLIENTS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
