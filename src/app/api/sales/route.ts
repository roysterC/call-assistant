import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { PERIOD_KINDS, resolvePeriod, type PeriodKind } from "@/lib/sales-period";
import { salonDate } from "@/lib/calendar-layout";
import { CURRENCY } from "@/lib/money";

/**
 * Takings for a window.
 *
 * Two figures, kept apart on purpose. `takenMinor` is money that actually
 * changed hands — appointments marked done, with the amount the desk recorded.
 * `expectedMinor` is what is still in the diary at list price. Adding them
 * together would produce a number that looks like revenue and is not, so the
 * report never does.
 *
 * Cancellations are excluded entirely; no-shows are listed, because a salon
 * wants to see them, but they count towards neither total.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
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

    // List prices, for what has not been rung up yet.
    const listPrice = new Map<string, number | null>();
    for (const s of cfg.services) {
      listPrice.set(s.name.toLowerCase(), s.priceMinor);
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        organizationId: ctx.organizationId,
        startsAt: { gte: new Date(period.from), lt: new Date(period.to) },
        status: { not: "cancelled" },
      },
      include: { lead: { select: { name: true, phone: true } } },
      orderBy: { startsAt: "asc" },
      // A year for a busy salon is a few thousand rows. Capped so one wide
      // query cannot pull the box over; the response says when it bit.
      take: 5000,
    });

    let takenMinor = 0;
    let expectedMinor = 0;
    let takenCount = 0;
    let unpricedCount = 0;

    const byStylist = new Map<string, { minor: number; count: number }>();
    const byService = new Map<string, { minor: number; count: number }>();

    const rows = appointments.map((a) => {
      const list = listPrice.get(a.serviceText.toLowerCase()) ?? null;
      const settled = a.status === "completed";
      // Only a recorded amount counts as taken. Falling back to list price
      // here would quietly turn a guess into revenue.
      const amountMinor = settled ? a.amountMinor : null;

      if (settled) {
        takenCount++;
        if (a.amountMinor === null) unpricedCount++;
        else takenMinor += a.amountMinor;
      } else if (a.status === "booked") {
        if (list !== null) expectedMinor += list;
      }

      const contribution = settled && a.amountMinor !== null ? a.amountMinor : 0;
      if (contribution) {
        const st = byStylist.get(a.stylistName) ?? { minor: 0, count: 0 };
        st.minor += contribution;
        st.count++;
        byStylist.set(a.stylistName, st);

        const sv = byService.get(a.serviceText) ?? { minor: 0, count: 0 };
        sv.minor += contribution;
        sv.count++;
        byService.set(a.serviceText, sv);
      }

      return {
        id: a.id,
        date: salonDate(a.startsAt, cfg.timeZone),
        startsAt: a.startsAt.toISOString(),
        clientName: a.lead?.name ?? null,
        serviceText: a.serviceText,
        stylistName: a.stylistName,
        status: a.status,
        source: a.source,
        amountMinor,
        listPriceMinor: list,
      };
    });

    const rank = (m: Map<string, { minor: number; count: number }>) =>
      [...m.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((x, y) => y.minor - x.minor);

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
      totals: {
        takenMinor,
        expectedMinor,
        takenCount,
        // Marked done but with no figure entered — the gap between what the
        // salon did and what the report can prove.
        unpricedCount,
        bookedCount: rows.filter((r) => r.status === "booked").length,
        noShowCount: rows.filter((r) => r.status === "no_show").length,
        byStylist: rank(byStylist),
        byService: rank(byService),
      },
      truncated: appointments.length >= 5000,
    });
  } catch (error) {
    console.error("[SALES API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
