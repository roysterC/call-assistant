/**
 * Every organisation's AI call cost this period, for super-admins.
 *
 *   GET /api/admin/usage?period=month&anchor=2026-09-26
 *
 * Periods are cut in UK time: this is the platform view, across salons, and
 * the salons it serves are in the UK.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { PERIOD_KINDS, describePeriod, resolvePeriod, type PeriodKind } from "@/lib/sales-period";
import { microsToPence, usdToGbp } from "@/lib/usage/cost";
import { perUnit, summariseUsage } from "@/lib/usage/summary";

const TZ = "Europe/London";

export async function GET(req: NextRequest) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  const params = req.nextUrl.searchParams;
  const kind = (PERIOD_KINDS as string[]).includes(params.get("period") ?? "")
    ? (params.get("period") as PeriodKind)
    : "month";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get("anchor") ?? "") ? params.get("anchor")! : today;
  const period = resolvePeriod(kind, anchor, TZ);

  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const usage = await summariseUsage(
    orgs.map((o) => o.id),
    new Date(period.from),
    new Date(period.to)
  );

  const rate = usdToGbp();
  const pence = (m: number | null) => (m === null ? null : microsToPence(m, rate));
  const rows = [...usage.values()].map((u) => {
    const cost = perUnit(u.costMicros, u.calls, u.seconds);
    return {
      organizationId: u.organizationId,
      calls: u.calls,
      minutes: u.seconds / 60,
      markupPercent: u.markupPercent,
      costPence: pence(u.costMicros),
      costPerCallPence: pence(cost.perCall),
      costPerMinutePence: pence(cost.perMinute),
      chargePence: pence(u.chargeMicros),
      marginPence: u.chargeMicros === null ? null : pence(u.chargeMicros - u.costMicros),
      labCostPence: pence(u.lab.costMicros),
    };
  });

  return NextResponse.json({
    period: { kind, anchor, label: describePeriod(period) },
    usdToGbp: rate,
    organizations: rows,
  });
}
