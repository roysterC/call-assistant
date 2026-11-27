/**
 * The nightly check (scripts/send-reminders.sh → /api/cron/billing-reconcile):
 * every salon Stripe knows is compared with Stripe and brought into line, for
 * the notices that never arrived or failed for good.
 *
 * For each salon with a Stripe customer:
 *  - its subscription's state, as Stripe has it now (a lost "cancelled" or
 *    "paid");
 *  - with none on record, a live one Stripe has for it (a lost Checkout);
 *  - the subscription's lines against its team and add-ons;
 *  - its invoices, into our copy.
 * What changed, what failed, and notices that failed or stuck, are reported,
 * and Kikai is emailed when there is anything to look at.
 */

import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { applySubscription, stripe, syncSubscription } from "@/lib/stripe-billing";
import { recordInvoicesOf } from "@/lib/stripe-invoices";

export interface ReconcileReport {
  checked: number;
  /** Salons put right, and what was wrong. */
  fixed: Array<{ organizationId: string; name: string; what: string[] }>;
  errors: Array<{ organizationId: string; name: string; error: string }>;
  /** Notices that failed, or have been "processing" for over an hour. */
  failedEvents: number;
  stuckEvents: number;
}

const LIVE = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);

const SNAPSHOT = {
  id: true,
  name: true,
  billingStatus: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  trialEndsAt: true,
  paymentFailedAt: true,
} as const;

type Snap = { billingStatus: string; stripeSubscriptionId: string | null; trialEndsAt: Date | null; paymentFailedAt: Date | null };

function differences(a: Snap, b: Snap): string[] {
  const out: string[] = [];
  if (a.billingStatus !== b.billingStatus) out.push(`state ${a.billingStatus} → ${b.billingStatus}`);
  if (a.stripeSubscriptionId !== b.stripeSubscriptionId) {
    out.push(b.stripeSubscriptionId ? `subscription ${b.stripeSubscriptionId} found` : `subscription ${a.stripeSubscriptionId} had ended`);
  }
  if ((a.trialEndsAt?.getTime() ?? null) !== (b.trialEndsAt?.getTime() ?? null)) out.push("trial end corrected");
  if (Boolean(a.paymentFailedAt) !== Boolean(b.paymentFailedAt)) out.push(b.paymentFailedAt ? "failed payment noted" : "failed payment cleared");
  return out;
}

export async function reconcileBilling(opts: { organizationId?: string } = {}): Promise<ReconcileReport> {
  const orgs = await prisma.organization.findMany({
    where: {
      OR: [{ stripeCustomerId: { not: null } }, { stripeSubscriptionId: { not: null } }],
      ...(opts.organizationId ? { id: opts.organizationId } : {}),
    },
    select: SNAPSHOT,
  });
  const report: ReconcileReport = { checked: 0, fixed: [], errors: [], failedEvents: 0, stuckEvents: 0 };

  for (const org of orgs) {
    report.checked++;
    try {
      const what: string[] = [];
      if (org.stripeSubscriptionId) {
        await applySubscription({ id: org.stripeSubscriptionId } as Stripe.Subscription, { fresh: true });
      } else if (org.stripeCustomerId) {
        const subs = await stripe().subscriptions.list({ customer: org.stripeCustomerId, status: "all", limit: 10 });
        const live = subs.data.find((s) => LIVE.has(s.status));
        if (live) await applySubscription(live, { fresh: true });
      }
      const synced = await syncSubscription(org.id);
      if (!synced.ok) throw new Error(synced.error);
      if (synced.changed) what.push("subscription lines brought up to date");
      const after = await prisma.organization.findUnique({ where: { id: org.id }, select: SNAPSHOT });
      if (after) what.unshift(...differences(org, after));
      const customer = after?.stripeCustomerId ?? org.stripeCustomerId;
      if (customer) await recordInvoicesOf(org.id, customer);
      if (what.length) report.fixed.push({ organizationId: org.id, name: org.name, what });
    } catch (e) {
      report.errors.push({ organizationId: org.id, name: org.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (!opts.organizationId) {
    [report.failedEvents, report.stuckEvents] = await Promise.all([
      prisma.stripeEvent.count({ where: { status: "failed" } }),
      prisma.stripeEvent.count({ where: { status: "processing", attemptedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } }),
    ]);
  }
  return report;
}

/** The report as lines for Kikai's email; empty when there is nothing to look at. */
export function reportLines(r: ReconcileReport): string[] {
  return [
    ...r.fixed.map((f) => `Put right, ${f.name}: ${f.what.join("; ")}.`),
    ...r.errors.map((e) => `Could not check ${e.name}: ${e.error}`),
    ...(r.failedEvents ? [`${r.failedEvents} Stripe notice(s) failed: replay them in Admin once the cause is fixed.`] : []),
    ...(r.stuckEvents ? [`${r.stuckEvents} Stripe notice(s) stuck mid-way for over an hour.`] : []),
  ];
}
