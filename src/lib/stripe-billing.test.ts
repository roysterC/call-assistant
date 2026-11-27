import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stripe billing against a fake Stripe and a one-salon database: the
 * subscription's lines follow the plan, Stripe's events set the salon's
 * state, and only Stripe's signature gets an event in.
 */

const db = vi.hoisted(() => {
  const org: Record<string, unknown> = {};
  const prices: Array<{ key: string; pence: number; stripePriceId: string | null }> = [];
  const team: Array<{ userId: string | null }> = [];
  const logins: Array<{ id: string; role: string }> = [];
  const match = (where: Record<string, unknown>) => {
    const ors = (where.OR as Array<Record<string, unknown>>) ?? [where];
    return ors.some((w) => Object.entries(w).every(([k, v]) => k === "id" ? v === "org1" : org[k] === v));
  };
  return {
    org,
    prices,
    team,
    logins,
    prisma: {
      organization: {
        findUnique: vi.fn(async () => ({ id: "org1", ...org })),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (match(where) ? { id: "org1", ...org } : null)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(org, data)),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const ok = Object.entries(where).every(([k, v]) => k === "id" || org[k] === v || (v === null && org[k] == null));
          if (ok) Object.assign(org, data);
          return { count: ok ? 1 : 0 };
        }),
      },
      billingPrice: {
        findMany: vi.fn(async () => prices),
        upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: never; update: Record<string, unknown> }) => {
          const row = prices.find((p) => p.key === where.key);
          if (row) Object.assign(row, update);
          else prices.push(create);
        }),
      },
      technician: { findMany: vi.fn(async () => team) },
      user: { findMany: vi.fn(async () => logins) },
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

import { applySubscription, invoiceFailed, invoicePaid, setStripeClient, syncSubscription } from "@/lib/stripe-billing";
import { verifyStripeEvent } from "@/lib/stripe-webhook";

function item(id: string, key: string | null, quantity: number) {
  return {
    id,
    quantity,
    price: { id: `price_${key}`, metadata: key ? { kikai_key: key } : {}, product: key ? `kikai_${key}` : "prod_other" },
  };
}

let subItems: ReturnType<typeof item>[] = [];
const fake = {
  products: { retrieve: vi.fn(async () => ({})), create: vi.fn() },
  prices: { create: vi.fn(async (p: { metadata: { kikai_key: string } }) => ({ id: `price_new_${p.metadata.kikai_key}` })) },
  subscriptions: {
    retrieve: vi.fn(async () => ({ id: "sub_1", status: "active", items: { data: subItems } })),
    update: vi.fn(),
  },
};

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  for (const k of Object.keys(db.org)) delete db.org[k];
  Object.assign(db.org, {
    billingStatus: "active",
    stripeSubscriptionId: "sub_1",
    stripeCustomerId: "cus_1",
    addons: [],
    trialEndsAt: null,
    paymentFailedAt: null,
    billedSeats: 0,
  });
  db.prices.length = 0;
  db.prices.push({ key: "base", pence: 900, stripePriceId: "price_base" }, { key: "seat", pence: 500, stripePriceId: "price_seat" });
  db.team.length = 0;
  db.logins.length = 0;
  subItems = [item("si_base", "base", 1)];
  vi.clearAllMocks();
  setStripeClient(fake as unknown as Stripe);
});

const updateItems = () => (fake.subscriptions.update.mock.calls[0] as unknown as [string, { items: unknown[] }])[1].items;

describe("the subscription's lines", () => {
  it("bill each person on the team but the owner, logins or not", async () => {
    db.team.push({ userId: "owner" }, { userId: null }, { userId: null });
    db.logins.push({ id: "owner", role: "admin" }, { id: "kim", role: "member" });
    await syncSubscription("org1");
    expect(updateItems()).toEqual([{ price: "price_seat", quantity: 3 }]);
    expect(db.org.billedSeats).toBe(3);
  });

  it("change the seats' quantity, and keep the line's price (the one the salon joined on)", async () => {
    subItems.push(item("si_seat", "seat", 1));
    db.team.push({ userId: null }, { userId: null }, { userId: null });
    await syncSubscription("org1");
    expect(updateItems()).toEqual([{ id: "si_seat", quantity: 2 }]);
  });

  it("add an add-on at its price, made in Stripe the first time", async () => {
    db.org.addons = ["chatReplies"];
    db.prices.push({ key: "chatReplies", pence: 1500, stripePriceId: null });
    await syncSubscription("org1");
    expect(fake.prices.create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 1500, currency: "gbp", tax_behavior: "inclusive", product: "kikai_chatReplies" })
    );
    expect(updateItems()).toEqual([{ price: "price_new_chatReplies", quantity: 1 }]);
  });

  it("drop an add-on taken off the plan, and leave alone a line Kikai added by hand", async () => {
    subItems.push(item("si_recep", "receptionist", 1), item("si_other", null, 1));
    await syncSubscription("org1");
    expect(updateItems()).toEqual([{ id: "si_recep", deleted: true }]);
  });

  it("change nothing when nothing changed", async () => {
    await syncSubscription("org1");
    expect(fake.subscriptions.update).not.toHaveBeenCalled();
  });

  it("are left alone for a salon with no card", async () => {
    db.org.stripeSubscriptionId = null;
    expect(await syncSubscription("org1")).toEqual({ ok: true });
    expect(fake.subscriptions.retrieve).not.toHaveBeenCalled();
  });
});

const sub = (status: string, extra: Record<string, unknown> = {}) =>
  ({ id: "sub_1", status, customer: "cus_1", metadata: { organizationId: "org1" }, trial_end: null, ...extra }) as unknown as Stripe.Subscription;

describe("Stripe's word on the subscription", () => {
  it("sets the salon's state", async () => {
    await applySubscription(sub("past_due"));
    expect(db.org.billingStatus).toBe("past_due");
    await applySubscription(sub("unpaid"));
    expect(db.org.billingStatus).toBe("restricted");
    await applySubscription(sub("active"));
    expect(db.org).toMatchObject({ billingStatus: "active", paymentFailedAt: null });
  });

  it("lets an ended subscription go, so the salon can add a card again", async () => {
    await applySubscription(sub("canceled"));
    expect(db.org).toMatchObject({ billingStatus: "restricted", stripeSubscriptionId: null });
  });

  it("keeps the trial's end in step", async () => {
    await applySubscription(sub("trialing", { trial_end: 1_800_000_000 }));
    expect(db.org.trialEndsAt).toEqual(new Date(1_800_000_000 * 1000));
  });

  it("never bills a salon Kikai does not bill", async () => {
    db.org.billingStatus = "free";
    await applySubscription(sub("unpaid"));
    expect(db.org.billingStatus).toBe("free");
  });

  it("ignores an old subscription's events", async () => {
    db.org.stripeSubscriptionId = "sub_new";
    await applySubscription(sub("canceled"));
    expect(db.org).toMatchObject({ billingStatus: "active", stripeSubscriptionId: "sub_new" });
  });
});

describe("payments", () => {
  const inv = { customer: "cus_1", parent: { subscription_details: { subscription: "sub_1" } } } as unknown as Stripe.Invoice;

  it("note the first failure, for the warning, and clear it once paid", async () => {
    await invoiceFailed(inv);
    const first = db.org.paymentFailedAt;
    expect(first).toBeInstanceOf(Date);
    await invoiceFailed(inv);
    expect(db.org.paymentFailedAt).toBe(first);
    await invoicePaid(inv);
    expect(db.org.paymentFailedAt).toBeNull();
  });
});

describe("the webhook", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });

  it("takes an event signed by Stripe", () => {
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
    expect(verifyStripeEvent(body, signature, secret)?.id).toBe("evt_1");
  });

  it("refuses one not signed, signed with another secret, or with no secret set", () => {
    const other = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_other" });
    expect(verifyStripeEvent(body, null, secret)).toBeNull();
    expect(verifyStripeEvent(body, other, secret)).toBeNull();
    expect(verifyStripeEvent(body, other, undefined)).toBeNull();
  });
});
