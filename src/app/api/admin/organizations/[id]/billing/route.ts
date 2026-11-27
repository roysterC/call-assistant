import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing";
import { cleanAddons } from "@/lib/plan-access";
import { syncSubscription } from "@/lib/stripe-billing";

/** A salon's plan, as Admin shows it (src/lib/billing.ts). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const summary = await billingSummary(id);
  if (!summary) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(summary);
}

/**
 * Kikai's changes to a salon's plan:
 *  - addons: the add-ons on its plan (a salon with a card is billed for them);
 *  - billingStatus "free" (not billed) or "trialing" (back on a trial), only
 *    while it has no Stripe subscription, which owns the state otherwise;
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
  // A fresh start (a trial, or not billed) leaves no failed payment behind:
  // its warning would hide the way to add a card.
  if ("billingStatus" in data || "trialEndsAt" in data) data.paymentFailedAt = null;
  if (typeof body.dismissRequest === "string") {
    data.addonRequests = org.addonRequests.filter((a) => a !== body.dismissRequest);
  }

  await prisma.organization.update({ where: { id }, data });
  // A salon with a card is billed for what changed.
  if (org.stripeSubscriptionId && "addons" in data) {
    const synced = await syncSubscription(id);
    if (!synced.ok) return NextResponse.json({ ...(await billingSummary(id)), stripeError: synced.error });
  }
  return NextResponse.json(await billingSummary(id));
}
