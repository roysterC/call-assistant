import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Our copy of invoices, and the nightly check that brings ours into line with Stripe. */

const db = vi.hoisted(() => ({
  orgs: [] as Array<Record<string, unknown>>,
  invoices: new Map<string, Record<string, unknown>>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findMany: vi.fn(async () => db.orgs.map((o) => ({ ...o }))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.orgs.find((o) => o.id === where.id) ?? null),
    },
    billingInvoice: {
      upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        db.invoices.set(where.id, { ...(db.invoices.get(where.id) ?? create), ...update });
      }),
    },
    stripeEvent: { count: vi.fn(async () => 0) },
  },
}));

const stripe = vi.hoisted(() => ({
  invoices: { retrieve: vi.fn(), list: vi.fn(async () => ({ data: [] as unknown[] })) },
  subscriptions: { list: vi.fn(async () => ({ data: [] as unknown[] })) },
}));
const billing = vi.hoisted(() => ({
  applySubscription: vi.fn(),
  syncSubscription: vi.fn(async () => ({ ok: true as const, changed: false })),
  orgFor: vi.fn(async () => ({ id: "org1" })),
}));
vi.mock("@/lib/stripe-billing", () => ({
  stripe: () => stripe,
  applySubscription: billing.applySubscription,
  syncSubscription: billing.syncSubscription,
  orgFor: billing.orgFor,
  invoiceSubscription: () => "sub_1",
}));

import { isOverdue, recordInvoice } from "@/lib/stripe-invoices";
import { reconcileBilling, reportLines } from "@/lib/stripe-reconcile";

const inv = (over: Record<string, unknown> = {}) =>
  ({
    id: "in_1",
    number: "KIKAI-0001",
    status: "paid",
    currency: "gbp",
    total: 1900,
    amount_due: 1900,
    amount_paid: 1900,
    amount_remaining: 0,
    period_start: 1_800_000_000,
    period_end: 1_802_592_000,
    created: 1_800_000_000,
    due_date: null,
    status_transitions: { paid_at: 1_800_000_100 },
    attempt_count: 1,
    next_payment_attempt: null,
    hosted_invoice_url: "https://invoice.stripe.com/i/x",
    customer: "cus_1",
    ...over,
  }) as unknown as Stripe.Invoice;

const org = (over: Record<string, unknown> = {}) => ({
  id: "org1",
  name: "Mai Nails",
  billingStatus: "active",
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_1",
  trialEndsAt: null,
  paymentFailedAt: null,
  ...over,
});

beforeEach(() => {
  db.orgs = [org()];
  db.invoices.clear();
  vi.clearAllMocks();
  billing.syncSubscription.mockResolvedValue({ ok: true, changed: false });
});

describe("our copy of an invoice", () => {
  it("keeps what was billed, paid and when", async () => {
    expect(await recordInvoice(inv())).toBe("org1");
    expect(db.invoices.get("in_1")).toMatchObject({
      organizationId: "org1",
      status: "paid",
      total: 1900,
      amountPaid: 1900,
      paidAt: new Date(1_800_000_100 * 1000),
      hostedInvoiceUrl: "https://invoice.stripe.com/i/x",
    });
  });

  it("is taken from Stripe as it is now, so a late 'open' never overwrites 'paid'", async () => {
    stripe.invoices.retrieve.mockResolvedValueOnce(inv());
    await recordInvoice(inv({ status: "open", amount_paid: 0, amount_remaining: 1900 }), { fresh: true });
    expect(db.invoices.get("in_1")).toMatchObject({ status: "paid" });
  });

  it("is overdue when owed after a failed try or past its due date, never when paid", () => {
    const now = new Date("2027-01-10");
    expect(isOverdue({ status: "open", amountRemaining: 900, attemptCount: 1, dueAt: null }, now)).toBe(true);
    expect(isOverdue({ status: "open", amountRemaining: 900, attemptCount: 0, dueAt: new Date("2027-01-01") }, now)).toBe(true);
    expect(isOverdue({ status: "open", amountRemaining: 900, attemptCount: 0, dueAt: null }, now)).toBe(false);
    expect(isOverdue({ status: "paid", amountRemaining: 0, attemptCount: 2, dueAt: null }, now)).toBe(false);
  });
});

describe("the nightly check", () => {
  it("reads each subscription as Stripe has it now, and brings its lines and invoices up to date", async () => {
    stripe.invoices.list.mockResolvedValueOnce({ data: [inv()] });
    const r = await reconcileBilling();
    expect(billing.applySubscription).toHaveBeenCalledWith({ id: "sub_1" }, { fresh: true });
    expect(billing.syncSubscription).toHaveBeenCalledWith("org1");
    expect(db.invoices.has("in_1")).toBe(true);
    expect(r).toMatchObject({ checked: 1, fixed: [], errors: [] });
    expect(reportLines(r)).toEqual([]);
  });

  it("says what it put right", async () => {
    billing.applySubscription.mockImplementationOnce(async () => {
      db.orgs[0].billingStatus = "restricted";
      db.orgs[0].stripeSubscriptionId = null;
      return "org1";
    });
    billing.syncSubscription.mockResolvedValueOnce({ ok: true, changed: true });
    const r = await reconcileBilling();
    expect(r.fixed).toEqual([
      {
        organizationId: "org1",
        name: "Mai Nails",
        what: ["state active → restricted", "subscription sub_1 had ended", "subscription lines brought up to date"],
      },
    ]);
    expect(reportLines(r)[0]).toContain("Put right, Mai Nails");
  });

  it("finds a subscription whose Checkout notice never came", async () => {
    db.orgs = [org({ stripeSubscriptionId: null, billingStatus: "trialing" })];
    const live = { id: "sub_lost", status: "trialing" };
    stripe.subscriptions.list.mockResolvedValueOnce({ data: [{ id: "sub_old", status: "canceled" }, live] });
    await reconcileBilling();
    expect(billing.applySubscription).toHaveBeenCalledWith(live, { fresh: true });
  });

  it("carries on past a salon it could not check, and says so", async () => {
    db.orgs = [org(), org({ id: "org2", name: "Polished" })];
    billing.syncSubscription.mockResolvedValueOnce({ ok: false, error: "Stripe is down" } as never);
    const r = await reconcileBilling();
    expect(r.checked).toBe(2);
    expect(r.errors).toEqual([{ organizationId: "org1", name: "Mai Nails", error: "Stripe is down" }]);
  });
});
