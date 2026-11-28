import { NextRequest, NextResponse, after } from "next/server";
import { linkOrigin } from "@/lib/app-origin";
import { notifyKikai } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing";
import { loadPlan, loadPrices } from "@/lib/plan-access";
import { addonsWith, changedAddons, isAddon, SELF_SERVE_ADDONS, type Addon } from "@/lib/plan";
import { BillingBusyError, syncLinesNow, withBillingLock } from "@/lib/stripe-billing";

const ADDON_NAME: Record<Addon, string> = {
  receptionist: "the phone receptionist",
  chatReplies: "AI chat replies",
  chatBooking: "booking by message",
  rebookTexts: "rebooking texts",
};

/**
 * The owner adds or removes an add-on: { addon, on }. Added to the plan at
 * once and billed from today (Stripe works out the part-month), once there
 * is a card. The receptionist, which Kikai sets up first, is a request:
 * Kikai adds it to the plan in Admin when its number is ready.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const body = (await req.json().catch(() => null)) as { addon?: unknown; on?: unknown } | null;
  const addon = body?.addon;
  if (!isAddon(addon) || typeof body?.on !== "boolean") {
    return NextResponse.json({ error: "Unknown add-on." }, { status: 400 });
  }
  const on = body.on;
  const plan = await loadPlan(ctx.organizationId);
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { addons: true, addonRequests: true },
  });
  if (!plan || !org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (on) {
    if (plan.access === "restricted") {
      return NextResponse.json({ error: "Update your card first: your plan is paused.", code: "plan_restricted" }, { status: 402 });
    }
    const { prices } = await loadPrices();
    if (addonsWith(addon).some((a) => prices[a] == null)) {
      return NextResponse.json({ error: "This add-on is not available yet." }, { status: 409 });
    }
    // Set up by Kikai first (or a salon Kikai does not bill): asked for.
    if (!SELF_SERVE_ADDONS.includes(addon) || plan.status === "free") {
      if (!org.addonRequests.includes(addon)) {
        const salon = await prisma.organization.update({
          where: { id: ctx.organizationId },
          data: { addonRequests: { push: addon } },
          select: { name: true },
        });
        const origin = linkOrigin(req.nextUrl.origin);
        after(() =>
          notifyKikai({
            subject: `${salon.name} asked for ${ADDON_NAME[addon]}`,
            lines: [`${salon.name} asked to add ${ADDON_NAME[addon]} to their plan. Set it up, then add it to their plan in Admin.`],
            button: "Open the salon in Admin",
            url: `${origin}/admin/organizations/${ctx.organizationId}`,
          })
        );
      }
      return NextResponse.json({ ...(await billingSummary(ctx.organizationId)), requested: addon });
    }
    if (!plan.hasCard) {
      return NextResponse.json({ error: "Add a card first: add-ons are billed monthly.", code: "card_needed" }, { status: 409 });
    }
  }

  // Read, change and bill as one, holding the salon's billing lease: no
  // other change (Admin, the team, another tab) can come between, so an undo
  // puts back exactly what this one changed.
  try {
    await withBillingLock(ctx.organizationId, async () => {
      const now = await prisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { addons: true, addonRequests: true },
      });
      if (!now) throw new Error("No such salon");
      const before = now.addons.filter(isAddon);
      await prisma.organization.update({
        where: { id: ctx.organizationId },
        data: {
          addons: changedAddons(before, addon, on),
          ...(on ? {} : { addonRequests: now.addonRequests.filter((a) => a !== addon) }),
        },
      });
      try {
        await syncLinesNow(ctx.organizationId);
      } catch (e) {
        // Put it back: the plan never says what Stripe is not charging for.
        await prisma.organization.update({
          where: { id: ctx.organizationId },
          data: { addons: now.addons, addonRequests: now.addonRequests },
        });
        throw e;
      }
    });
  } catch (e) {
    if (e instanceof BillingBusyError) {
      return NextResponse.json({ error: "Another change to your plan is still being made, so nothing changed. Try again in a moment.", code: "busy" }, { status: 409 });
    }
    console.error("[BILLING] add-on change:", e);
    return NextResponse.json({ error: "Could not reach Stripe, so nothing changed. Try again in a minute." }, { status: 502 });
  }
  return NextResponse.json(await billingSummary(ctx.organizationId));
}
