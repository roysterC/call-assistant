import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { isOverdue } from "@/lib/stripe-invoices";

/**
 * Billing across every salon, for Admin: money taken this month and last
 * (from our copy of Stripe's invoices), what is overdue and whose, how many
 * salons are in each state, and Stripe notices that failed.
 */
export async function GET() {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [thisMonth, lastMonth, open, states, failed] = await Promise.all([
    prisma.billingInvoice.aggregate({ _sum: { amountPaid: true }, where: { paidAt: { gte: monthStart } } }),
    prisma.billingInvoice.aggregate({ _sum: { amountPaid: true }, where: { paidAt: { gte: lastMonthStart, lt: monthStart } } }),
    prisma.billingInvoice.findMany({
      where: { status: "open", amountRemaining: { gt: 0 } },
      orderBy: { issuedAt: "asc" },
      include: { organization: { select: { name: true } } },
    }),
    prisma.organization.groupBy({ by: ["billingStatus"], _count: { _all: true } }),
    prisma.stripeEvent.findMany({
      where: { status: "failed" },
      orderBy: { receivedAt: "desc" },
      take: 50,
      select: { id: true, type: true, organizationId: true, error: true, attempts: true, receivedAt: true },
    }),
  ]);

  return NextResponse.json({
    collected: { thisMonth: thisMonth._sum.amountPaid ?? 0, lastMonth: lastMonth._sum.amountPaid ?? 0 },
    overdue: open
      .filter((i) => isOverdue(i, now))
      .map((i) => ({
        id: i.id,
        organizationId: i.organizationId,
        salon: i.organization.name,
        number: i.number,
        amountRemaining: i.amountRemaining,
        issuedAt: i.issuedAt,
        attemptCount: i.attemptCount,
        nextPaymentAttempt: i.nextPaymentAttempt,
        hostedInvoiceUrl: i.hostedInvoiceUrl,
      })),
    states: Object.fromEntries(states.map((s) => [s.billingStatus, s._count._all])),
    failedEvents: failed,
  });
}
