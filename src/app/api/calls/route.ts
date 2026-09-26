import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { chargeFor, microsToPence } from "@/lib/usage/cost";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = { organizationId: ctx.organizationId };
    if (status) where.status = status;

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        include: { lead: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.call.count({ where }),
    ]);

    // What a call cost us is for super-admins only. Owners get what they are
    // charged for it — our cost with their markup — once one is set, and the
    // raw figure never reaches them, even unrendered.
    const org = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { usageMarkupPercent: true },
    });
    const withMoney = calls.map((c) => {
      const costMicros = c.costCents === null ? null : c.costCents * 10_000;
      const charge = costMicros === null ? null : chargeFor(costMicros, org?.usageMarkupPercent);
      return {
        ...c,
        costCents: ctx.isSuperAdmin ? c.costCents : undefined,
        costPence: ctx.isSuperAdmin && costMicros !== null ? microsToPence(costMicros) : undefined,
        chargePence: charge === null ? null : microsToPence(charge),
      };
    });

    return NextResponse.json({
      calls: withMoney,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("[CALLS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
