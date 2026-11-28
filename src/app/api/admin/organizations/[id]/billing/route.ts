import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing";
import { cleanAddons, loadPrices } from "@/lib/plan-access";
import { trialEnd } from "@/lib/plan";
import { stopBillingForFree, syncLinesNow, withBillingLock } from "@/lib/stripe-billing";

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
    select: { stripeSubscriptionId: true, addons: true, addonRequests: true, trialEndsAt: true },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Everything is checked before anything changes, here or in Stripe.
  const data: Record<string, unknown> = {};
  if ("addons" in body) {
    const addons = cleanAddons(body.addons);
    // A newly added add-on needs a price: there is nothing to bill it at.
    const { prices } = await loadPrices();
    const unpriced = addons.filter((a) => !org.addons.includes(a) && prices[a] == null);
    if (unpriced.length) {
      return NextResponse.json({ error: "Set a price for it in Prices first: there is nothing to bill it at." }, { status: 409 });
    }
    data.addons = addons;
    // What it asked for and now has is no longer a request.
    data.addonRequests = org.addonRequests.filter((a) => !addons.includes(a as never));
  }
  if ("billingStatus" in body) {
    if (body.billingStatus !== "free" && body.billingStatus !== "trialing") {
      return NextResponse.json({ error: "Set a salon to not billed or on trial; Stripe sets the rest." }, { status: 400 });
    }
    if (org.stripeSubscriptionId && body.billingStatus === "trialing") {
      return NextResponse.json(
        { error: "This salon pays by card: change its subscription in Stripe, which keeps this page up to date." },
        { status: 409 }
      );
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
  }
  // A trial always ends: put on one with no end given (or none left), it
  // runs the usual 14 days from now.
  if (data.billingStatus === "trialing") {
    const end = "trialEndsAt" in data ? (data.trialEndsAt as Date | null) : org.trialEndsAt;
    if (!end || end <= new Date()) data.trialEndsAt = trialEnd();
  }
  // A new end is a new countdown: its reminders go again.
  if ("trialEndsAt" in data) data.trialReminderSent = null;
  // A fresh start (a trial, or not billed) leaves no failed payment behind:
  // its warning would hide the way to add a card.
  // A wipe warning goes too: a salon given a new start is warned afresh if
  // it is ever paused and idle again (src/lib/purge.ts).
  if ("billingStatus" in data || "trialEndsAt" in data) {
    data.paymentFailedAt = null;
    data.purgeWarnedAt = null;
  }
  if (typeof body.dismissRequest === "string") {
    const requests = (data.addonRequests as string[] | undefined) ?? org.addonRequests;
    data.addonRequests = requests.filter((a) => a !== body.dismissRequest);
  }

  // Not billed, for a salon with a card: Stripe first, and only then ours.
  if (data.billingStatus === "free" && org.stripeSubscriptionId) {
    const stopped = await stopBillingForFree(id);
    if (!stopped.ok) {
      return NextResponse.json({ error: `Stripe would not cancel the subscription, so nothing changed: ${stopped.error}` }, { status: 502 });
    }
  }

  // A salon with a card is billed for what changed (not one just made free):
  // written and billed as one under its billing lease, and put back if
  // Stripe will not take it, so the plan never says what is not charged.
  if (org.stripeSubscriptionId && "addons" in data && data.billingStatus !== "free") {
    try {
      await withBillingLock(id, async () => {
        const before = await prisma.organization.findUnique({ where: { id }, select: { addons: true, addonRequests: true } });
        await prisma.organization.update({ where: { id }, data });
        try {
          await syncLinesNow(id);
        } catch (e) {
          await prisma.organization.update({
            where: { id },
            data: { addons: before?.addons ?? org.addons, addonRequests: before?.addonRequests ?? org.addonRequests },
          });
          throw e;
        }
      });
    } catch (e) {
      return NextResponse.json(
        { error: `Stripe would not take the change, so the add-ons are as they were: ${e instanceof Error ? e.message : String(e)}` },
        { status: 502 }
      );
    }
  } else {
    await prisma.organization.update({ where: { id }, data });
  }
  return NextResponse.json({ ...(await billingSummary(id)), ...(await history(id)) });
}
