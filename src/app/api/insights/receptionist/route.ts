import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { resolvePeriod } from "@/lib/sales-period";
import { zonedDateString } from "@/lib/business-hours";
import { listPriceLookup } from "@/lib/takings";
import { summariseReceptionist } from "@/lib/receptionist-insights";

const DAYS = [7, 30, 90];

/** What the phone receptionist did over the last 7, 30 or 90 salon days. */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const days = Number(new URL(req.url).searchParams.get("days") || 30);
    if (!DAYS.includes(days)) {
      return NextResponse.json({ error: `days must be one of: ${DAYS.join(", ")}` }, { status: 400 });
    }

    const orgId = ctx.organizationId;
    const cfg = await getSalonConfig(orgId);
    const now = new Date();
    // From the start of the first salon day in the window.
    const firstDay = zonedDateString(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000), cfg.timeZone);
    const since = new Date(resolvePeriod("day", firstDay, cfg.timeZone).from);

    const [calls, bookings, callbacks] = await Promise.all([
      prisma.call.findMany({
        where: { organizationId: orgId, createdAt: { gte: since } },
        select: { createdAt: true, duration: true, outcomes: true },
        take: 20000,
      }),
      prisma.appointment.findMany({
        where: { organizationId: orgId, source: "voice", createdAt: { gte: since }, status: { not: "cancelled" } },
        select: { createdAt: true, serviceText: true },
        take: 20000,
      }),
      prisma.callback.count({ where: { organizationId: orgId, createdAt: { gte: since } } }),
    ]);

    return NextResponse.json(
      summariseReceptionist({
        calls,
        bookings,
        callbacks,
        priceOf: listPriceLookup(cfg),
        hours: cfg.hours,
        timeZone: cfg.timeZone,
        days,
        now,
      })
    );
  } catch (error) {
    console.error("[RECEPTIONIST INSIGHTS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
