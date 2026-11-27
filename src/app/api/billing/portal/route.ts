import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { linkOrigin } from "@/lib/app-origin";
import { portalLink, stripeConfigured } from "@/lib/stripe-billing";

/** Stripe's own page for the salon's card and invoices. */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  if (!stripeConfigured()) return NextResponse.json({ error: "Card payments are not set up yet." }, { status: 503 });
  try {
    const url = await portalLink(ctx.organizationId, `${linkOrigin(req.nextUrl.origin)}/settings#plan`);
    if (!url) return NextResponse.json({ error: "No card on file yet." }, { status: 409 });
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[BILLING] portal:", e);
    return NextResponse.json({ error: "Could not reach Stripe. Try again in a minute." }, { status: 502 });
  }
}
