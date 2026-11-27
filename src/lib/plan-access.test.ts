import { beforeEach, describe, expect, it, vi } from "vitest";

/** The checks the routes call, against one salon's plan. */

const db = vi.hoisted(() => ({ org: null as Record<string, unknown> | null }));
vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique: vi.fn(async () => db.org) } },
}));

import { addonOn, cleanAddons, refuseIfRestricted } from "@/lib/plan-access";

const day = 864e5;
beforeEach(() => {
  db.org = { billingStatus: "active", trialEndsAt: null, stripeSubscriptionId: "sub_1", addons: ["receptionist"], paymentFailedAt: null };
});

describe("a paused plan", () => {
  it("refuses something new with a 402 the screens can recognise", async () => {
    db.org!.billingStatus = "restricted";
    const res = await refuseIfRestricted("org1");
    expect(res?.status).toBe(402);
    expect(await res!.json()).toMatchObject({ code: "plan_restricted" });
  });

  it("is a trial that ended with no card, with nothing run at midnight", async () => {
    db.org = { billingStatus: "trialing", trialEndsAt: new Date(Date.now() - day), stripeSubscriptionId: null, addons: [] };
    expect((await refuseIfRestricted("org1"))?.status).toBe(402);
  });

  it("lets Kikai's super-admins through, to help", async () => {
    db.org!.billingStatus = "restricted";
    expect(await refuseIfRestricted("org1", { isSuperAdmin: true })).toBeNull();
  });

  it("refuses nothing while the plan is good, a payment is being retried, or the trial runs", async () => {
    expect(await refuseIfRestricted("org1")).toBeNull();
    db.org!.billingStatus = "past_due";
    expect(await refuseIfRestricted("org1")).toBeNull();
    db.org = { billingStatus: "trialing", trialEndsAt: new Date(Date.now() + day), stripeSubscriptionId: null, addons: [] };
    expect(await refuseIfRestricted("org1")).toBeNull();
  });
});

describe("an add-on", () => {
  it("works on the plan, and not off it or while paused", async () => {
    expect(await addonOn("org1", "receptionist")).toBe(true);
    expect(await addonOn("org1", "chatReplies")).toBe(false);
    db.org!.billingStatus = "restricted";
    expect(await addonOn("org1", "receptionist")).toBe(false);
  });

  it("does not work for a salon that is not there", async () => {
    db.org = null;
    expect(await addonOn("nope", "receptionist")).toBe(false);
  });

  it("is only one we know, once", () => {
    expect(cleanAddons(["chatReplies", "chatReplies", "teleport", 3])).toEqual(["chatReplies"]);
    expect(cleanAddons("chatReplies")).toEqual([]);
  });
});
