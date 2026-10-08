import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

/**
 * Lead counts for an organisation without the diary (chat, WhatsApp), whose
 * dashboard has no salon figures. A salon's dashboard reads /api/dashboard.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const orgId = ctx.organizationId;

    const [totalLeads, newLeads] = await Promise.all([
      prisma.lead.count({ where: { organizationId: orgId } }),
      prisma.lead.count({ where: { organizationId: orgId, createdAt: { gte: weekStart } } }),
    ]);

    return NextResponse.json({ totalLeads, newLeads });
  } catch (error) {
    console.error("[STATS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
