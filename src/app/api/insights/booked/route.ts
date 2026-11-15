import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { resolvePeriod } from "@/lib/sales-period";
import { salonDate } from "@/lib/calendar-layout";
import { listPriceLookup } from "@/lib/takings";
import { summariseBooked } from "@/lib/booked-value";

const PERIODS = ["week", "month", "year", "all"] as const;
type Period = (typeof PERIODS)[number];

/**
 * What Kikai has booked the salon this week, month or year, or ever:
 * the bookings the receptionist made on a call or in a chat, by when they
 * were made, cancelled ones left out.
 *
 *   GET /api/insights/booked?period=month
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const period = (new URL(req.url).searchParams.get("period") || "month") as Period;
    if (!PERIODS.includes(period)) {
      return NextResponse.json({ error: `period must be one of: ${PERIODS.join(", ")}` }, { status: 400 });
    }

    const orgId = ctx.organizationId;
    const cfg = await getSalonConfig(orgId);
    const today = salonDate(new Date(), cfg.timeZone);
    const window = period === "all" ? null : resolvePeriod(period, today, cfg.timeZone);

    const rows = await prisma.appointment.findMany({
      where: {
        organizationId: orgId,
        source: "voice",
        status: { not: "cancelled" },
        ...(window ? { createdAt: { gte: new Date(window.from), lt: new Date(window.to) } } : {}),
      },
      select: { createdAt: true, serviceText: true, amountMinor: true, notes: true },
      orderBy: { createdAt: "asc" },
      take: 50000,
    });

    return NextResponse.json({
      period,
      // The first day counted: the window's, or the first booking Kikai made.
      from: window ? window.firstDate : rows[0] ? salonDate(rows[0].createdAt, cfg.timeZone) : null,
      today,
      ...summariseBooked({ rows, priceOf: listPriceLookup(cfg), hours: cfg.hours, timeZone: cfg.timeZone }),
    });
  } catch (error) {
    console.error("[INSIGHTS BOOKED API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
