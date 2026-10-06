import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { resolvePeriod } from "@/lib/sales-period";
import { salonDate } from "@/lib/calendar-layout";
import { computeTakings } from "@/lib/takings";

/**
 * The salon's day at a glance: today's diary, this week's takings, what the
 * receptionist booked, and who is waiting for a call back. Days and weeks are
 * the salon's own (its time zone, weeks from Monday), so "today" here is the
 * same day the diary and the Sales page show.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const orgId = ctx.organizationId;
    const cfg = await getSalonConfig(orgId);
    const today = salonDate(new Date(), cfg.timeZone);
    const day = resolvePeriod("day", today, cfg.timeZone);
    const week = resolvePeriod("week", today, cfg.timeZone);
    const month = resolvePeriod("month", today, cfg.timeZone);
    const within = (p: { from: string; to: string }) => ({ gte: new Date(p.from), lt: new Date(p.to) });

    const [
      appointments,
      takings,
      bookedThisMonth,
      bookedByAssistant,
      pendingCallbacks,
      oldestCallback,
      callsToday,
      callsThisWeek,
      recentCalls,
    ] = await Promise.all([
      prisma.appointment.findMany({
        where: { organizationId: orgId, startsAt: within(day), status: { not: "cancelled" } },
        orderBy: { startsAt: "asc" },
        take: 200,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          serviceText: true,
          stylistName: true,
          status: true,
          source: true,
          patchTestRequired: true,
          lead: { select: { name: true, phone: true } },
        },
      }),
      computeTakings(orgId, week, cfg),
      // Bookings made this month, whenever they are for: the work done, not the diary.
      prisma.appointment.count({
        where: { organizationId: orgId, createdAt: within(month), status: { not: "cancelled" } },
      }),
      prisma.appointment.count({
        where: { organizationId: orgId, createdAt: within(month), status: { not: "cancelled" }, source: "voice" },
      }),
      prisma.callback.count({ where: { organizationId: orgId, status: "pending" } }),
      prisma.callback.findFirst({
        where: { organizationId: orgId, status: "pending" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      prisma.call.count({ where: { organizationId: orgId, createdAt: within(day) } }),
      prisma.call.count({ where: { organizationId: orgId, createdAt: within(week) } }),
      prisma.call.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          phoneNumber: true,
          duration: true,
          outcomes: true,
          createdAt: true,
          lead: { select: { name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      today,
      timeZone: cfg.timeZone,
      appointments,
      takings: { takenMinor: takings.totals.takenMinor, expectedMinor: takings.totals.expectedMinor },
      bookings: { thisMonth: bookedThisMonth, byAssistant: bookedByAssistant },
      callbacks: { pending: pendingCallbacks, oldestAt: oldestCallback?.createdAt ?? null },
      calls: { today: callsToday, thisWeek: callsThisWeek, recent: recentCalls },
    });
  } catch (error) {
    console.error("[DASHBOARD API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
