import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { linkOrigin } from "@/lib/app-origin";
import { startCheckout, stripeConfigured } from "@/lib/stripe-billing";

/** Stripe's page to add a card: the rest of the free trial carries over. */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  if (!stripeConfigured()) return NextResponse.json({ error: "Card payments are not set up yet." }, { status: 503 });
  const back = `${linkOrigin(req.nextUrl.origin)}/settings`;
  try {
    const r = await startCheckout(ctx.organizationId, { success: `${back}?card=added#plan`, cancel: `${back}#plan` });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    return NextResponse.json({ url: r.url });
  } catch (e) {
    console.error("[BILLING] checkout:", e);
    return NextResponse.json({ error: "Could not reach Stripe. Try again in a minute." }, { status: 502 });
  }
}
