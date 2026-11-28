import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

/**
 * The notice log: each Stripe notice is handled once, one that failed is
 * handled again, one being handled is not handled twice at once, and Kikai
 * can replay one.
 */

type Row = { id: string; status: string; attempts: number; attemptedAt: Date; error: string | null; organizationId: string | null; payload: unknown };
const db = vi.hoisted(() => ({ rows: new Map<string, Row>() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stripeEvent: {
      create: vi.fn(async ({ data }: { data: Pick<Row, "id" | "status" | "payload"> }) => {
        if (db.rows.has(data.id)) {
          throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
        }
        db.rows.set(data.id, { ...data, attempts: 1, attemptedAt: new Date(), error: null, organizationId: null });
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; OR: Array<Record<string, unknown>> }; data: Record<string, unknown> }) => {
        const r = db.rows.get(where.id);
        const ok =
          r &&
          where.OR.some(
            (c) =>
              c.status === r.status &&
              (!c.attemptedAt || r.attemptedAt < (c.attemptedAt as { lt: Date }).lt)
          );
        if (!ok) return { count: 0 };
        Object.assign(r, { ...data, attempts: r.attempts + 1 });
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.rows.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(db.rows.get(where.id)!, data)),
    },
    billingInvoice: { findMany: vi.fn(async () => []) },
  },
}));

const handlers = vi.hoisted(() => ({
  applySubscription: vi.fn(async () => "org1"),
  checkoutDone: vi.fn(async () => "org1"),
  invoiceFailed: vi.fn(async () => "org1"),
  invoicePaid: vi.fn(async () => "org1"),
  recordInvoice: vi.fn(async (): Promise<{ organizationId: string; invoice: Record<string, unknown> } | null> => ({
    organizationId: "org1",
    invoice: { status: "open", amount_remaining: 900 },
  })),
  retrieve: vi.fn(),
}));
vi.mock("@/lib/stripe-billing", () => ({
  applySubscription: handlers.applySubscription,
  checkoutDone: handlers.checkoutDone,
  invoiceFailed: handlers.invoiceFailed,
  invoicePaid: handlers.invoicePaid,
  stripe: () => ({ events: { retrieve: handlers.retrieve } }),
}));
vi.mock("@/lib/stripe-invoices", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe-invoices")>()),
  recordInvoice: handlers.recordInvoice,
}));

import { processEvent, replayEvent } from "@/lib/stripe-events";

const event = (type: string, id = "evt_1") => ({ id, type, data: { object: { id: "sub_1" } } }) as unknown as Stripe.Event;

beforeEach(() => {
  db.rows.clear();
  vi.clearAllMocks();
  handlers.applySubscription.mockResolvedValue("org1");
});

describe("a Stripe notice", () => {
  it("is logged with the salon it was for, and handled", async () => {
    expect(await processEvent(event("customer.subscription.updated"))).toBe("done");
    expect(handlers.applySubscription).toHaveBeenCalledWith(expect.anything(), { fresh: true });
    expect(db.rows.get("evt_1")).toMatchObject({ status: "done", organizationId: "org1" });
  });

  it("sent again once handled, is skipped", async () => {
    await processEvent(event("customer.subscription.updated"));
    expect(await processEvent(event("customer.subscription.updated"))).toBe("duplicate");
    expect(handlers.applySubscription).toHaveBeenCalledTimes(1);
  });

  it("that failed, is noted, and handled when Stripe sends it again", async () => {
    handlers.applySubscription.mockRejectedValueOnce(new Error("database down"));
    await expect(processEvent(event("customer.subscription.updated"))).rejects.toThrow("database down");
    expect(db.rows.get("evt_1")).toMatchObject({ status: "failed", error: "database down" });
    expect(await processEvent(event("customer.subscription.updated"))).toBe("done");
    expect(db.rows.get("evt_1")).toMatchObject({ status: "done", attempts: 2 });
  });

  it("being handled when it comes again, is left to the first", async () => {
    db.rows.set("evt_1", { id: "evt_1", status: "processing", attempts: 1, attemptedAt: new Date(), error: null, organizationId: null, payload: {} });
    expect(await processEvent(event("customer.subscription.updated"))).toBe("busy");
    expect(handlers.applySubscription).not.toHaveBeenCalled();
  });

  it("stuck mid-way (a restart), is taken over after five minutes", async () => {
    db.rows.set("evt_1", { id: "evt_1", status: "processing", attempts: 1, attemptedAt: new Date(Date.now() - 6 * 60_000), error: null, organizationId: null, payload: {} });
    expect(await processEvent(event("customer.subscription.updated"))).toBe("done");
  });

  it("about an invoice keeps our copy, and notes a failed payment", async () => {
    await processEvent(event("invoice.payment_failed"));
    expect(handlers.recordInvoice).toHaveBeenCalledWith(expect.anything(), { fresh: true });
    expect(handlers.invoiceFailed).toHaveBeenCalled();
  });

  it("that a payment failed, arriving after the invoice was paid, brings no warning back", async () => {
    handlers.recordInvoice.mockResolvedValueOnce({ organizationId: "org1", invoice: { status: "paid", amount_remaining: 0 } });
    await processEvent(event("invoice.payment_failed"));
    expect(handlers.invoiceFailed).not.toHaveBeenCalled();
  });

  it("that a payment went through clears the warning, unless another invoice is still owed", async () => {
    await processEvent(event("invoice.paid", "evt_a"));
    expect(handlers.invoicePaid).toHaveBeenCalledTimes(1);
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.billingInvoice.findMany).mockResolvedValueOnce([
      { status: "open", amountRemaining: 900, attemptCount: 2, dueAt: null },
    ] as never);
    await processEvent(event("invoice.paid", "evt_b"));
    expect(handlers.invoicePaid).toHaveBeenCalledTimes(1);
  });

  it("of a kind we do not use, is logged and left", async () => {
    expect(await processEvent(event("customer.created"))).toBe("done");
    expect(db.rows.get("evt_1")?.organizationId).toBeNull();
  });
});

describe("replaying a notice", () => {
  it("handles it again from Stripe's copy, even one handled before", async () => {
    await processEvent(event("customer.subscription.updated"));
    handlers.retrieve.mockResolvedValueOnce(event("customer.subscription.updated"));
    expect(await replayEvent("evt_1")).toEqual({ ok: true, outcome: "done" });
    expect(handlers.applySubscription).toHaveBeenCalledTimes(2);
  });

  it("uses our copy when Stripe no longer has it", async () => {
    db.rows.set("evt_1", { id: "evt_1", status: "failed", attempts: 1, attemptedAt: new Date(), error: "x", organizationId: null, payload: event("customer.subscription.deleted") });
    handlers.retrieve.mockRejectedValueOnce(new Error("gone"));
    expect(await replayEvent("evt_1")).toEqual({ ok: true, outcome: "done" });
  });
});
