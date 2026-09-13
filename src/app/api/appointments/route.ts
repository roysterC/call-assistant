import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

const VALID_STATUSES = ["booked", "cancelled", "completed", "no_show"];

/**
 * Appointments the agent has booked.
 *
 * The diary itself lives in the provider (Google Calendar). This is our own
 * record of what was booked, so the dashboard can show overnight bookings
 * without calling Google on every page load, and so the salon still has a
 * record if an event is later edited or deleted there.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "booked";
    const scope = searchParams.get("scope") || "upcoming";

    const where: Record<string, unknown> = {
      organizationId: ctx.organizationId,
    };
    if (status !== "all") where.status = status;

    // Default to what still matters: appointments yet to happen. A salon
    // opening at nine wants this morning's bookings, not last month's.
    if (scope === "upcoming") {
      where.startsAt = { gte: new Date() };
    } else if (scope === "past") {
      where.startsAt = { lt: new Date() };
    }

    const appointments = await prisma.appointment.findMany({
      where,
      include: { lead: true },
      orderBy: { startsAt: scope === "past" ? "desc" : "asc" },
      take: 200,
    });

    return NextResponse.json({ appointments });
  } catch (error) {
    console.error("[APPOINTMENTS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json();
    const { id, status, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify ownership before touching anything.
    const existing = await prisma.appointment.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "at least one of status, notes is required" },
        { status: 400 }
      );
    }

    const appointment = await prisma.appointment.update({ where: { id }, data });

    // Deliberately does NOT remove the event from the stylist's calendar.
    // Google is the diary and staff work in it directly; a dashboard status
    // change silently deleting an event out from under them would be worse
    // than the two records disagreeing. Cancelling in Google is the real
    // cancellation — this flag is our record of it.
    return NextResponse.json({ appointment });
  } catch (error) {
    console.error("[APPOINTMENTS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
