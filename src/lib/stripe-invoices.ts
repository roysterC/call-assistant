/**
 * Our copy of each salon's Stripe invoices (BillingInvoice): what was billed,
 * what was paid and when, and what is overdue, for Admin. Kept up to date
 * from Stripe's invoice notices (src/lib/stripe-events.ts) and the nightly
 * check (src/lib/stripe-reconcile.ts). Stripe's copy is the record; ours is
 * always made from it, never the other way round.
 */

import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { invoiceSubscription, orgFor, stripe } from "@/lib/stripe-billing";

const at = (secs: number | null | undefined) => (secs ? new Date(secs * 1000) : null);

/** The invoice as our row has it. */
export function invoiceRow(inv: Stripe.Invoice) {
  return {
    number: inv.number ?? null,
    status: inv.status ?? "draft",
    currency: inv.currency,
    total: inv.total,
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    amountRemaining: inv.amount_remaining,
    periodStart: at(inv.period_start),
    periodEnd: at(inv.period_end),
    issuedAt: at(inv.created) ?? new Date(),
    dueAt: at(inv.due_date),
    paidAt: at(inv.status_transitions?.paid_at),
    attemptCount: inv.attempt_count ?? 0,
    nextPaymentAttempt: at(inv.next_payment_attempt),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
  };
}

/**
 * Keep our copy of one invoice. With `fresh`, as Stripe has it now: its
 * notices come late and out of order, and an old "open" must not overwrite
 * "paid". Returns the salon's id, or null for an invoice that is no salon's.
 */
export async function recordInvoice(inv: Stripe.Invoice, opts: { fresh?: boolean; organizationId?: string } = {}): Promise<string | null> {
  if (opts.fresh && inv.id) inv = await stripe().invoices.retrieve(inv.id);
  if (!inv.id) return null;
  const customer = typeof inv.customer === "string" ? inv.customer : (inv.customer?.id ?? null);
  const organizationId =
    opts.organizationId ?? (await orgFor({ subscription: invoiceSubscription(inv), customer }))?.id ?? null;
  if (!organizationId) {
    console.warn(`[BILLING] invoice ${inv.id} matches no salon`);
    return null;
  }
  const row = invoiceRow(inv);
  await prisma.billingInvoice.upsert({
    where: { id: inv.id },
    create: { id: inv.id, organizationId, ...row },
    update: row,
  });
  return organizationId;
}

/** Every invoice of a salon's Stripe customer, newest first, kept: the nightly check, or a salon's first look. */
export async function recordInvoicesOf(organizationId: string, customer: string, limit = 24): Promise<number> {
  const list = await stripe().invoices.list({ customer, limit });
  for (const inv of list.data) await recordInvoice(inv, { organizationId });
  return list.data.length;
}

/** Owed and not paid: open, with something left to pay, past its due date or after a failed try. */
export function isOverdue(inv: { status: string; amountRemaining: number; attemptCount: number; dueAt: Date | null }, now = new Date()): boolean {
  if (inv.status !== "open" || inv.amountRemaining <= 0) return false;
  return inv.attemptCount > 0 || Boolean(inv.dueAt && inv.dueAt.getTime() < now.getTime());
}
