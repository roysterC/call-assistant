/**
 * A salon's AI call usage over a period.
 *
 * The same numbers, shown two ways. A salon owner gets calls, minutes and what
 * they are charged (our cost with their markup), and nothing at all about
 * money until a super-admin has set that markup. A super-admin gets the cost
 * underneath, the margin, where the cost came from, and the lab testing that
 * is on our bill but never on theirs.
 *
 *   GET /api/usage?period=month&anchor=2026-09-26
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { PERIOD_KINDS, describePeriod, resolvePeriod, type PeriodKind } from "@/lib/sales-period";
import { microsToPence, rates, usdToGbp } from "@/lib/usage/cost";
import { perUnit, summariseUsage } from "@/lib/usage/summary";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  const params = req.nextUrl.searchParams;
  const kind = (PERIOD_KINDS as string[]).includes(params.get("period") ?? "")
    ? (params.get("period") as PeriodKind)
    : "month";
  const cfg = await getSalonConfig(ctx.organizationId);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.timeZone }).format(new Date());
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get("anchor") ?? "") ? params.get("anchor")! : today;
  const period = resolvePeriod(kind, anchor, cfg.timeZone);

  const u = (await summariseUsage([ctx.organizationId], new Date(period.from), new Date(period.to))).get(
    ctx.organizationId
  );
  if (!u) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  const rate = usdToGbp();
  const pence = (m: number | null) => (m === null ? null : microsToPence(m, rate));
  const minutes = u.seconds / 60;
  const charge = perUnit(u.chargeMicros, u.calls, u.seconds);

  const forOwner = {
    period: { kind, anchor, label: describePeriod(period) },
    calls: u.calls,
    minutes,
    priced: u.chargeMicros !== null,
    chargePence: pence(u.chargeMicros),
    chargePerCallPence: pence(charge.perCall),
    chargePerMinutePence: pence(charge.perMinute),
  };
  if (!ctx.isSuperAdmin) return NextResponse.json(forOwner);

  const cost = perUnit(u.costMicros, u.calls, u.seconds);
  return NextResponse.json({
    ...forOwner,
    markupPercent: u.markupPercent,
    costPence: pence(u.costMicros),
    costPerCallPence: pence(cost.perCall),
    costPerMinutePence: pence(cost.perMinute),
    marginPence: u.chargeMicros === null ? null : pence(u.chargeMicros - u.costMicros),
    sources: {
      vapiPence: pence(u.vapiCostMicros),
      receptionistPence: pence(u.receptionistCostMicros),
    },
    lab: {
      conversations: u.lab.conversations,
      minutes: u.lab.seconds / 60,
      costPence: pence(u.lab.costMicros),
    },
    assumptions: { usdToGbp: rate, rates: rates() },
  });
}
