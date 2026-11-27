import { NextRequest, NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { linkOrigin } from "@/lib/app-origin";
import { notifyKikai } from "@/lib/notify";
import { stripeConfigured } from "@/lib/stripe-billing";
import { reconcileBilling, reportLines } from "@/lib/stripe-reconcile";

/**
 * The nightly billing check against Stripe (src/lib/stripe-reconcile.ts),
 * run by the same timer as the reminders (scripts/send-reminders.sh). Safe
 * to run at any time, and again: it only brings ours into line with Stripe.
 * `?org=<id>` checks one salon (and emails nobody).
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) {
    console.warn("[CRON] Rejected billing check: bad or missing CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!stripeConfigured()) return NextResponse.json({ skipped: "Stripe is not set up" });

  const only = new URL(req.url).searchParams.get("org") ?? undefined;
  const report = await reconcileBilling({ organizationId: only });
  const lines = reportLines(report);
  if (lines.length && !only) {
    await notifyKikai({
      subject: `Billing check: ${report.fixed.length} put right, ${report.errors.length} failed`,
      lines,
      button: "Open Admin",
      url: `${linkOrigin(req.nextUrl.origin)}/admin/organizations`,
    });
  }
  if (lines.length) console.warn("[BILLING CHECK]", lines.join(" | "));
  return NextResponse.json(report);
}
