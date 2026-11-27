import { beforeEach, describe, expect, it, vi } from "vitest";

/** Paused salons nobody uses: warned, then wiped, least recently used first, only once the database is full. */

const db = vi.hoisted(() => ({
  bytes: 0,
  orgs: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
  emails: [] as Array<{ to: string; subject: string }>,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ size: BigInt(db.bytes) }]),
    organization: {
      findMany: vi.fn(async ({ where }: { where: { lastActiveAt: { lt: Date } } }) =>
        db.orgs
          .filter((o) => o.billingStatus !== "free" && (o.lastActiveAt as Date) < where.lastActiveAt.lt)
          .sort((a, b) => (a.lastActiveAt as Date).getTime() - (b.lastActiveAt as Date).getTime())
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const o = db.orgs.find((x) => x.id === where.id)!;
        if (o.purgeWarnedAt) return { count: 0 };
        Object.assign(o, data);
        return { count: 1 };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => db.deleted.push(where.id)),
    },
    user: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  },
}));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async (e: { to: string; subject: string }) => {
    db.emails.push(e);
    return { ok: true, id: "1" };
  }),
}));
const stripe = vi.hoisted(() => ({ stop: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/stripe-billing", () => ({ stopBillingForFree: stripe.stop, stripeConfigured: () => true }));

import { purgeLimitBytes, purgePaused } from "@/lib/purge";

const NOW = new Date("2027-06-01T02:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5);
const GB = 1024 ** 3;

function salon(id: string, idleDays: number, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    billingStatus: "trialing",
    trialEndsAt: daysAgo(idleDays),
    stripeSubscriptionId: null,
    addons: [],
    purgeWarnedAt: null,
    lastActiveAt: daysAgo(idleDays),
    users: [{ email: `${id}@example.com`, language: "en" }],
    ...over,
  };
}

beforeEach(() => {
  process.env.PURGE_WHEN_DB_OVER_GB = "10";
  db.bytes = 11 * GB;
  db.orgs = [];
  db.deleted = [];
  db.emails = [];
  vi.clearAllMocks();
});

describe("wiping paused salons", () => {
  it("does nothing while the database is under its limit, or no limit is set", async () => {
    db.orgs = [salon("old", 200, { purgeWarnedAt: daysAgo(30) })];
    db.bytes = 5 * GB;
    expect(await purgePaused("https://app", NOW)).toMatchObject({ over: false, candidates: 1, deleted: [], warned: [] });
    delete process.env.PURGE_WHEN_DB_OVER_GB;
    db.bytes = 500 * GB;
    expect(await purgePaused("https://app", NOW)).toMatchObject({ over: false, deleted: [] });
    expect(purgeLimitBytes("0")).toBeNull();
  });

  it("warns the owner first, and deletes only 14 days after", async () => {
    db.orgs = [salon("quiet", 120)];
    const first = await purgePaused("https://app", NOW);
    expect(first.warned).toEqual(["quiet"]);
    expect(db.emails[0]).toMatchObject({ to: "quiet@example.com" });
    expect(db.emails[0].subject).toContain("will be deleted");
    expect(db.deleted).toEqual([]);
    db.orgs[0].purgeWarnedAt = daysAgo(15);
    expect((await purgePaused("https://app", NOW)).deleted).toEqual(["quiet"]);
  });

  it("goes least recently used first, a few a night", async () => {
    db.orgs = Array.from({ length: 8 }, (_, i) => salon(`s${i}`, 100 + i * 10, { purgeWarnedAt: daysAgo(20) }));
    const r = await purgePaused("https://app", NOW);
    expect(r.deleted).toEqual(["s7", "s6", "s5", "s4", "s3"]);
  });

  it("never wipes a salon in use, paying, on its trial, or one Kikai does not bill", async () => {
    db.orgs = [
      salon("recent", 30, { purgeWarnedAt: daysAgo(20) }),
      salon("paying", 200, { billingStatus: "active", stripeSubscriptionId: "sub_1", purgeWarnedAt: daysAgo(20) }),
      salon("trial", 200, { trialEndsAt: new Date(NOW.getTime() + 864e5), purgeWarnedAt: daysAgo(20) }),
    ];
    const r = await purgePaused("https://app", NOW);
    expect(r.deleted).toEqual([]);
    expect(r.candidates).toBe(0);
  });

  it("cancels a subscription Stripe still holds before deleting, and keeps the salon if Stripe refuses", async () => {
    db.orgs = [salon("unpaid", 200, { billingStatus: "restricted", stripeSubscriptionId: "sub_1", purgeWarnedAt: daysAgo(20) })];
    stripe.stop.mockResolvedValueOnce({ ok: false, error: "down" } as never);
    const r = await purgePaused("https://app", NOW);
    expect(r.deleted).toEqual([]);
    expect(r.errors[0]).toContain("Stripe: down");
    expect((await purgePaused("https://app", NOW)).deleted).toEqual(["unpaid"]);
    expect(stripe.stop).toHaveBeenCalledWith("unpaid");
  });

  it("on a dry run, says what is a candidate and changes nothing", async () => {
    db.orgs = [salon("quiet", 120, { purgeWarnedAt: daysAgo(30) })];
    expect(await purgePaused("https://app", NOW, { dryRun: true })).toMatchObject({ candidates: 1, deleted: [], warned: [] });
  });
});
