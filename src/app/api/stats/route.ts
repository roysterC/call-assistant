import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const orgId = ctx.organizationId;

    const [
      totalCalls,
      callsToday,
      callsThisWeek,
      callsThisMonth,
      totalLeads,
      newLeads,
      pendingCallbacks,
      avgDuration,
      recentCalls,
      sentimentCounts,
      callVolumeRaw,
    ] = await Promise.all([
      prisma.call.count({ where: { organizationId: orgId } }),
      prisma.call.count({ where: { organizationId: orgId, createdAt: { gte: todayStart } } }),
      prisma.call.count({ where: { organizationId: orgId, createdAt: { gte: weekStart } } }),
      prisma.call.count({ where: { organizationId: orgId, createdAt: { gte: monthStart } } }),
      prisma.lead.count({ where: { organizationId: orgId } }),
      prisma.lead.count({ where: { organizationId: orgId, createdAt: { gte: weekStart } } }),
      prisma.callback.count({ where: { organizationId: orgId, status: "pending" } }),
      prisma.call.aggregate({ where: { organizationId: orgId }, _avg: { duration: true } }),
      prisma.call.findMany({
        where: { organizationId: orgId },
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { lead: true },
      }),
      prisma.call.groupBy({
        by: ["sentiment"],
        where: { organizationId: orgId },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT DATE("createdAt")::text as day, COUNT(*)::int as count
        FROM ca_calls
        WHERE "createdAt" > ${thirtyDaysAgo}
          AND "organizationId" = ${orgId}
        GROUP BY DATE("createdAt")
        ORDER BY day
      `,
    ]);

    const sentimentDistribution = sentimentCounts.map((s) => ({
      sentiment: s.sentiment || "unknown",
      count: s._count._all,
    }));

    const callVolume = (callVolumeRaw || []).map((r) => ({
      day: r.day,
      count: Number(r.count),
    }));

    return NextResponse.json({
      totalCalls,
      callsToday,
      callsThisWeek,
      callsThisMonth,
      totalLeads,
      newLeads,
      pendingCallbacks,
      avgDuration: Math.round(avgDuration._avg.duration || 0),
      recentCalls,
      sentimentDistribution,
      callVolume,
    });
  } catch (error) {
    console.error("[STATS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
