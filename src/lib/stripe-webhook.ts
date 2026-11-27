import Stripe from "stripe";

/**
 * A Stripe event, if its signature is Stripe's for STRIPE_WEBHOOK_SECRET;
 * null otherwise (and always while the secret is not set).
 */
export function verifyStripeEvent(body: string, signature: string | null, secret = process.env.STRIPE_WEBHOOK_SECRET): Stripe.Event | null {
  if (!secret || !signature) return null;
  try {
    return Stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return null;
  }
}
