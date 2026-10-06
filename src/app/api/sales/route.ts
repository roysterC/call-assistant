import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { PERIOD_KINDS, resolvePeriod, type PeriodKind } from "@/lib/sales-period";
import { salonDate } from "@/lib/calendar-layout";
import { computeTakings } from "@/lib/takings";
import { CURRENCY } from "@/lib/money";

/** Takings for a window: see src/lib/takings.ts. */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);

    const kindParam = (searchParams.get("period") || "month") as PeriodKind;
    if (!PERIOD_KINDS.includes(kindParam)) {
      return NextResponse.json(
        { error: `period must be one of: ${PERIOD_KINDS.join(", ")}` },
        { status: 400 }
      );
    }

    const cfg = await getSalonConfig(ctx.organizationId);
    const anchor = searchParams.get("anchor") || salonDate(new Date(), cfg.timeZone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
      return NextResponse.json(
        { error: "anchor must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const period = resolvePeriod(kindParam, anchor, cfg.timeZone);

    const { rows, totals, truncated } = await computeTakings(
      ctx.organizationId,
      period,
      cfg
    );

    return NextResponse.json({
      currency: CURRENCY,
      period: {
        kind: period.kind,
        anchor: period.anchor,
        from: period.from,
        to: period.to,
        firstDate: period.firstDate,
        lastDate: period.lastDate,
      },
      rows,
      totals,
      truncated,
    });
  } catch (error) {
    console.error("[SALES API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
