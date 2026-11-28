import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Kikai's changes to a salon's plan in Admin. */

const db = vi.hoisted(() => ({ org: {} as Record<string, unknown> }));
vi.mock("@/lib/tenant", () => ({ requireSuperAdmin: async () => ({ userId: "k" }), isErrorResponse: () => false }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => ({ ...db.org })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(db.org, data)),
    },
    billingInvoice: { findMany: vi.fn(async () => []) },
    stripeEvent: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/billing", () => ({ billingSummary: async () => ({ plan: {} }) }));
vi.mock("@/lib/plan-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/plan-access")>()),
  loadPrices: async () => ({ prices: { base: 900, seat: 500, chatReplies: 1500 }, rows: {} }),
}));
const stripe = vi.hoisted(() => ({ sync: vi.fn(async () => ({ ok: true, changed: true })), stop: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/stripe-billing", () => ({
  syncLinesNow: stripe.sync,
  stopBillingForFree: stripe.stop,
  withBillingLock: async (_id: string, fn: () => Promise<unknown>) => fn(),
}));

import { PUT } from "./route";

const put = (body: Record<string, unknown>) =>
  PUT(new NextRequest("http://x/api/admin/organizations/org1/billing", { method: "PUT", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "org1" }),
  });

beforeEach(() => {
  db.org = { stripeSubscriptionId: "sub_1", addons: [], addonRequests: ["receptionist"], trialEndsAt: null };
  vi.clearAllMocks();
});

describe("add-ons in Admin", () => {
  it("refuses a new one with no price: there is nothing to bill it at", async () => {
    const res = await put({ addons: ["receptionist"] });
    expect(res.status).toBe(409);
    expect(db.org.addons).toEqual([]);
  });

  it("puts the plan back when Stripe will not take the change", async () => {
    stripe.sync.mockRejectedValueOnce(new Error("Stripe is down"));
    const res = await put({ addons: ["chatReplies"] });
    expect(res.status).toBe(502);
    expect(db.org).toMatchObject({ addons: [], addonRequests: ["receptionist"] });
  });
});

describe("trials in Admin", () => {
  it("never makes one with no end", async () => {
    db.org = { stripeSubscriptionId: null, addons: [], addonRequests: [], trialEndsAt: null };
    await put({ billingStatus: "trialing" });
    expect(db.org.trialEndsAt).toBeInstanceOf(Date);
    expect((db.org.trialEndsAt as Date).getTime()).toBeGreaterThan(Date.now() + 13 * 864e5);
  });

  it("keeps a trial's end that is still to come", async () => {
    const end = new Date(Date.now() + 5 * 864e5);
    db.org = { stripeSubscriptionId: null, addons: [], addonRequests: [], trialEndsAt: end };
    await put({ billingStatus: "trialing" });
    expect(db.org.trialEndsAt).toEqual(end);
  });
});

describe("making a salon free", () => {
  it("checks everything before Stripe is touched", async () => {
    const res = await put({ billingStatus: "free", trialEndsAt: "not a date" });
    expect(res.status).toBe(409);
    expect(stripe.stop).not.toHaveBeenCalled();
  });

  it("sets premium chat, Kikai's own switch", async () => {
    await put({ premiumChat: true });
    expect(db.org.premiumChat).toBe(true);
  });
});
