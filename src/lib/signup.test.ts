import { beforeEach, describe, expect, it, vi } from "vitest";

/** A salon signing itself up: the salon on its trial, the owner's login, onboarding next. */

const db = vi.hoisted(() => ({
  orgs: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => db.orgs.find((o) => o.slug === where.slug) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const o = { id: `org${db.orgs.length + 1}`, ...data };
        db.orgs.push(o);
        return { id: o.id, name: o.name };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => db.users.find((u) => u.email === where.email) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const u = { id: `u${db.users.length + 1}`, ...data };
        db.users.push(u);
        return { id: u.id };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        db.users = db.users.filter((u) => u.id !== where.id);
      }),
    },
  };
  return { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/lib/password", () => ({
  hashPassword: async () => "hash",
  validatePassword: (p: string) => (p.length < 8 ? "Use at least 8 characters." : null),
}));

import { freeSlug, signUpSalon, slugFrom } from "@/lib/signup";

const NOW = new Date("2026-12-01T10:00:00Z");
const good = { salon: "Mai Nails & Spa", name: "Mai", email: " Mai@Example.com ", password: "long enough", language: "vi", now: NOW };

beforeEach(() => {
  db.orgs = [];
  db.users = [];
});

describe("signing up", () => {
  it("makes the salon on a 14-day trial from now, set up for onboarding, and its owner's login", async () => {
    const r = await signUpSalon(good);
    expect(r).toMatchObject({ ok: true, salon: "Mai Nails & Spa", email: "mai@example.com" });
    expect(db.orgs[0]).toMatchObject({
      slug: "mai-nails-spa",
      needsOnboarding: true,
      billingStatus: "trialing",
      trialEndsAt: new Date(NOW.getTime() + 14 * 864e5),
    });
    expect(db.users[0]).toMatchObject({ email: "mai@example.com", role: "admin", organizationId: "org1", language: "vi" });
  });

  it("refuses an email that already has a login", async () => {
    db.users.push({ id: "x", email: "mai@example.com", organizationId: "other", role: "admin" });
    expect(await signUpSalon(good)).toMatchObject({ ok: false, status: 409, code: "taken" });
    expect(db.orgs).toHaveLength(0);
  });

  it("replaces a login left by a deleted salon", async () => {
    db.users.push({ id: "old", email: "mai@example.com", organizationId: null, role: "admin" });
    expect(await signUpSalon(good)).toMatchObject({ ok: true });
    expect(db.users).toHaveLength(1);
    expect(db.users[0].id).not.toBe("old");
  });

  it("says what is missing", async () => {
    expect(await signUpSalon({ ...good, salon: " " })).toMatchObject({ ok: false, code: "salon" });
    expect(await signUpSalon({ ...good, name: "" })).toMatchObject({ ok: false, code: "name" });
    expect(await signUpSalon({ ...good, email: "nope" })).toMatchObject({ ok: false, code: "email" });
    expect(await signUpSalon({ ...good, password: "short" })).toMatchObject({ ok: false, code: "weak" });
  });
});

describe("the salon's web address", () => {
  it("is made from its name", () => {
    expect(slugFrom("Mai Nails & Spa")).toBe("mai-nails-spa");
    expect(slugFrom("Tiệm Nail Đẹp")).toBe("tiem-nail-dep");
  });

  it("is one nobody has, and never one of Kikai's own", async () => {
    db.orgs.push({ slug: "mai-nails" });
    expect(await freeSlug("Mai Nails")).toBe("mai-nails-2");
    expect(await freeSlug("Book")).toBe("book-2");
    expect(await freeSlug("123")).toBe("salon-123");
  });
});
