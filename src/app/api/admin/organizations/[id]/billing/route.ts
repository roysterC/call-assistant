import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing";
import { cleanAddons } from "@/lib/plan-access";
import { stopBillingForFree, syncSubscription } from "@/lib/stripe-billing";

/** Its invoices (our copy of Stripe's) and the Stripe notices about it. */
async function history(organizationId: string) {
  const [invoices, events] = await Promise.all([
    prisma.billingInvoice.findMany({
      where: { organizationId },
      orderBy: { issuedAt: "desc" },
      take: 12,
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        amountPaid: true,
        amountRemaining: true,
        issuedAt: true,
        paidAt: true,
        attemptCount: true,
        dueAt: true,
        hostedInvoiceUrl: true,
      },
    }),
    prisma.stripeEvent.findMany({
      where: { organizationId },
      orderBy: { receivedAt: "desc" },
      take: 10,
      select: { id: true, type: true, status: true, error: true, attempts: true, receivedAt: true },
    }),
  ]);
  return { invoices, events };
}

/** A salon's plan, as Admin shows it (src/lib/billing.ts), with its invoices and Stripe notices. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const summary = await billingSummary(id);
  if (!summary) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...summary, ...(await history(id)) });
}

/**
 * Kikai's changes to a salon's plan:
 *  - addons: the add-ons on its plan (a salon with a card is billed for them);
 *  - billingStatus "free" (not billed): for a salon paying by card, its
 *    Stripe subscription is cancelled at once and what it owes voided
 *    (stopBillingForFree), so the card is never charged again;
 *  - billingStatus "trialing" (back on a trial), only while it has no
 *    Stripe subscription, which owns the state otherwise;
 *  - trialEndsAt: move the trial's end (extend it, say), only while it has
 *    no card: a card's trial is Stripe's;
 *  - dismissRequest: an add-on it asked for that Kikai will not set up.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { stripeSubscriptionId: true, addonRequests: true },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if ("addons" in body) {
    const addons = cleanAddons(body.addons);
    data.addons = addons;
    // What it asked for and now has is no longer a request.
    data.addonRequests = org.addonRequests.filter((a) => !addons.includes(a as never));
  }
  if ("billingStatus" in body) {
    if (body.billingStatus !== "free" && body.billingStatus !== "trialing") {
      return NextResponse.json({ error: "Set a salon to not billed or on trial; Stripe sets the rest." }, { status: 400 });
    }
    if (org.stripeSubscriptionId) {
      if (body.billingStatus === "trialing") {
        return NextResponse.json(
          { error: "This salon pays by card: change its subscription in Stripe, which keeps this page up to date." },
          { status: 409 }
        );
      }
      // Not billed: Stripe first, and only then ours.
      const stopped = await stopBillingForFree(id);
      if (!stopped.ok) {
        return NextResponse.json({ error: `Stripe would not cancel the subscription, so nothing changed: ${stopped.error}` }, { status: 502 });
      }
    }
    data.billingStatus = body.billingStatus;
  }
  if ("trialEndsAt" in body) {
    // A salon with a card has its trial in Stripe, which would put it back.
    if (org.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "This salon pays by card: change its trial in Stripe, which keeps this page up to date." },
        { status: 409 }
      );
    }
    const d = body.trialEndsAt === null ? null : new Date(String(body.trialEndsAt));
    if (d && Number.isNaN(d.getTime())) return NextResponse.json({ error: "Not a date." }, { status: 400 });
    data.trialEndsAt = d;
    // A new end is a new countdown: its reminders go again.
    data.trialReminderSent = null;
  }
  // A fresh start (a trial, or not billed) leaves no failed payment behind:
  // its warning would hide the way to add a card.
  if ("billingStatus" in data || "trialEndsAt" in data) data.paymentFailedAt = null;
  if (typeof body.dismissRequest === "string") {
    data.addonRequests = org.addonRequests.filter((a) => a !== body.dismissRequest);
  }

  await prisma.organization.update({ where: { id }, data });
  // A salon with a card is billed for what changed (not one just made free).
  if (org.stripeSubscriptionId && "addons" in data && data.billingStatus !== "free") {
    const synced = await syncSubscription(id);
    if (!synced.ok) return NextResponse.json({ ...(await billingSummary(id)), ...(await history(id)), stripeError: synced.error });
  }
  return NextResponse.json({ ...(await billingSummary(id)), ...(await history(id)) });
}
