import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { applySubscription, checkoutDone, invoiceFailed, invoicePaid } from "@/lib/stripe-billing";
import { verifyStripeEvent } from "@/lib/stripe-webhook";

/**
 * Stripe's billing events (src/lib/stripe-billing.ts). Signed with
 * STRIPE_WEBHOOK_SECRET; anything unsigned is refused. Send these from the
 * Stripe dashboard's webhook for this address:
 *   checkout.session.completed, customer.subscription.created,
 *   customer.subscription.updated, customer.subscription.deleted,
 *   invoice.payment_failed, invoice.paid
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const event = verifyStripeEvent(body, req.headers.get("stripe-signature"));
  if (!event) return NextResponse.json({ error: "Bad signature" }, { status: 400 });

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await checkoutDone(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        // As Stripe has it now: events come late and out of order.
        await applySubscription(event.data.object as Stripe.Subscription, { fresh: true });
        break;
      case "invoice.payment_failed":
        await invoiceFailed(event.data.object as Stripe.Invoice);
        break;
      case "invoice.paid":
        await invoicePaid(event.data.object as Stripe.Invoice);
        break;
    }
  } catch (e) {
    // A 500 has Stripe send it again later.
    console.error(`[STRIPE WEBHOOK] ${event.type} ${event.id} failed:`, e);
    return NextResponse.json({ error: "Not handled" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
