import { NextRequest, NextResponse } from "next/server";
import { processEvent } from "@/lib/stripe-events";
import { verifyStripeEvent } from "@/lib/stripe-webhook";

/**
 * Stripe's billing notices (src/lib/stripe-events.ts). Signed with
 * STRIPE_WEBHOOK_SECRET; anything unsigned is refused. Each is logged once by
 * its id: one sent again is skipped. Send these from the Stripe dashboard's
 * webhook for this address:
 *   checkout.session.completed, customer.subscription.created,
 *   customer.subscription.updated, customer.subscription.deleted,
 *   invoice.finalized, invoice.updated, invoice.paid, invoice.payment_failed,
 *   invoice.voided, invoice.marked_uncollectible
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const event = verifyStripeEvent(body, req.headers.get("stripe-signature"));
  if (!event) return NextResponse.json({ error: "Bad signature" }, { status: 400 });

  try {
    const outcome = await processEvent(event);
    // Still being handled from an earlier delivery: Stripe sends it again
    // later, by when it is done (and skipped) or failed (and retried).
    if (outcome === "busy") return NextResponse.json({ received: true, outcome }, { status: 409 });
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // A 500 has Stripe send it again later; why it failed is in the log.
    console.error(`[STRIPE WEBHOOK] ${event.type} ${event.id} failed:`, e);
    return NextResponse.json({ error: "Not handled" }, { status: 500 });
  }
}
