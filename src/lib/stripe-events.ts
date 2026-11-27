/**
 * Stripe's notices (src/app/api/stripe/webhook), each kept once by its id in
 * StripeEvent before it is acted on:
 *
 *  - one Stripe sends again after it was handled is skipped ("duplicate");
 *  - one that failed is tried again when Stripe sends it again (it retries
 *    for days), or when Kikai replays it from Admin (replayEvent);
 *  - one still being handled when it comes again is answered "busy", and
 *    Stripe sends it later; one stuck "processing" for five minutes (a
 *    restart mid-way) is taken over;
 *  - Kikai has a record of what Stripe said, when, and about which salon.
 *
 * Handling one twice changes nothing anyway (each reads Stripe's current
 * state rather than the notice's); the log makes that a rule, not a hope.
 */

import type Stripe from "stripe";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { applySubscription, checkoutDone, invoiceFailed, invoicePaid, stripe } from "@/lib/stripe-billing";
import { isOverdue, recordInvoice } from "@/lib/stripe-invoices";

const STUCK_MS = 5 * 60 * 1000;

export type Outcome = "done" | "duplicate" | "busy";

/** What a notice is about: its subscription, invoice or Checkout page. */
function objectIdOf(event: Stripe.Event): string | null {
  const obj = event.data.object as { id?: unknown };
  return typeof obj.id === "string" ? obj.id : null;
}

/** Take the notice for handling: false when it was handled, or is being handled now. */
async function claim(event: Stripe.Event, force = false): Promise<"new" | "again" | "duplicate" | "busy"> {
  try {
    await prisma.stripeEvent.create({
      data: {
        id: event.id,
        type: event.type,
        objectId: objectIdOf(event),
        status: "processing",
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
    return "new";
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  const taken = await prisma.stripeEvent.updateMany({
    where: {
      id: event.id,
      OR: [
        { status: "failed" },
        { status: "processing", attemptedAt: { lt: new Date(Date.now() - STUCK_MS) } },
        ...(force ? [{ status: "done" }] : []),
      ],
    },
    data: { status: "processing", attempts: { increment: 1 }, attemptedAt: new Date(), error: null },
  });
  if (taken.count === 1) return "again";
  const row = await prisma.stripeEvent.findUnique({ where: { id: event.id }, select: { status: true } });
  return row?.status === "done" ? "duplicate" : "busy";
}

/** Act on one notice. Returns the salon it was for, if any. */
export async function handleEvent(event: Stripe.Event): Promise<string | null> {
  const type = event.type as string;
  if (type === "checkout.session.completed") {
    return checkoutDone(event.data.object as Stripe.Checkout.Session);
  }
  if (type.startsWith("customer.subscription.")) {
    // As Stripe has it now: notices come late and out of order.
    return applySubscription(event.data.object as Stripe.Subscription, { fresh: true });
  }
  if (type.startsWith("invoice.")) {
    const inv = event.data.object as Stripe.Invoice;
    const orgId = await recordInvoice(inv, { fresh: true });
    if (!orgId) return null;
    if (type === "invoice.payment_failed") await invoiceFailed(inv);
    // Paid: the warning goes, unless another invoice is still owed (an old
    // "paid" arriving after a newer failure must not hide it).
    if (type === "invoice.paid") {
      const owed = await prisma.billingInvoice.findMany({
        where: { organizationId: orgId, status: "open" },
        select: { status: true, amountRemaining: true, attemptCount: true, dueAt: true },
      });
      if (!owed.some((i) => isOverdue(i))) await invoicePaid(inv);
    }
    return orgId;
  }
  return null;
}

/**
 * Keep, then act on, one notice. Throws when acting on it failed, after
 * noting why, so the webhook answers 500 and Stripe sends it again.
 */
export async function processEvent(event: Stripe.Event, opts: { force?: boolean } = {}): Promise<Outcome> {
  const claimed = await claim(event, opts.force);
  if (claimed === "duplicate" || claimed === "busy") return claimed;
  try {
    const organizationId = await handleEvent(event);
    await prisma.stripeEvent.update({
      where: { id: event.id },
      data: { status: "done", processedAt: new Date(), organizationId },
    });
    return "done";
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.stripeEvent
      .update({ where: { id: event.id }, data: { status: "failed", error: error.slice(0, 2000) } })
      .catch(() => {});
    throw e;
  }
}

/**
 * Kikai's "try again" on a notice from Admin: Stripe's own copy if it still
 * has it (it keeps them 30 days), else ours.
 */
export async function replayEvent(id: string): Promise<{ ok: true; outcome: Outcome } | { ok: false; error: string }> {
  const row = await prisma.stripeEvent.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "No such notice." };
  let event: Stripe.Event;
  try {
    event = await stripe().events.retrieve(id);
  } catch {
    event = row.payload as unknown as Stripe.Event;
  }
  try {
    return { ok: true, outcome: await processEvent(event, { force: true }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
