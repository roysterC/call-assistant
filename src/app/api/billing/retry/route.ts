import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing";
import { retryPayment, stripeConfigured } from "@/lib/stripe-billing";

/** Pay what is owed now, with the card on file (after changing it). */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  if (!stripeConfigured()) return NextResponse.json({ error: "Card payments are not set up yet." }, { status: 503 });
  try {
    const r = await retryPayment(ctx.organizationId);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "The payment did not go through." }, { status: 402 });
  } catch (e) {
    console.error("[BILLING] retry:", e);
    return NextResponse.json({ error: "Could not reach Stripe. Try again in a minute." }, { status: 502 });
  }
  return NextResponse.json(await billingSummary(ctx.organizationId));
}
