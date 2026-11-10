import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An owner's invite link: made once, kept only as a hash, used once, within
 * a week, and never for an address that already has a login.
 */

const db = vi.hoisted(() => {
  const tx = {
    invitation: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
  };
  return {
    tx,
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    invitation: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
  validatePassword: (p: string) => (p.length < 8 ? "Password must be at least 8 characters" : null),
}));

import {
  INVITE_DAYS,
  acceptInvitation,
  createInvitation,
  hashInviteToken,
  inviteStatus,
  looksLikeInviteToken,
  newInviteToken,
  readInvitation,
} from "./invitations";

const NOW = new Date("2026-11-10T12:00:00Z");
const LATER = new Date("2026-11-12T12:00:00Z");
const { token: TOKEN } = newInviteToken();

function stored(over: Record<string, unknown> = {}) {
  return {
    id: "inv1",
    email: "owner@salon.test",
    role: "admin",
    organizationId: "org1",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: LATER,
    organization: { name: "Salon", enabled: true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.organization.findUnique.mockResolvedValue({ id: "org1" });
  db.user.findUnique.mockResolvedValue(null);
  db.tx.invitation.updateMany.mockResolvedValue({ count: 1 });
  db.tx.invitation.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "inv2", ...data }));
  db.tx.invitation.findUnique.mockResolvedValue(stored());
  db.tx.user.findUnique.mockResolvedValue(null);
  db.invitation.findUnique.mockResolvedValue(stored());
});

describe("tokens", () => {
  it("are long and random, and only their hash is kept", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(looksLikeInviteToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashInviteToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });

  it("refuses anything not shaped like one", () => {
    expect(looksLikeInviteToken("abc")).toBe(false);
    expect(looksLikeInviteToken(undefined)).toBe(false);
    expect(looksLikeInviteToken("x".repeat(42) + "!")).toBe(false);
  });
});

describe("inviteStatus", () => {
  const base = { acceptedAt: null, revokedAt: null, expiresAt: LATER };
  it("is pending until used, withdrawn or out of date", () => {
    expect(inviteStatus(base, NOW)).toBe("pending");
    expect(inviteStatus({ ...base, acceptedAt: NOW }, NOW)).toBe("accepted");
    expect(inviteStatus({ ...base, revokedAt: NOW }, NOW)).toBe("revoked");
    expect(inviteStatus(base, new Date(LATER.getTime() + 1))).toBe("expired");
  });
});

describe("createInvitation", () => {
  it("makes an owner's link for a week, replacing any open one for them", async () => {
    const r = await createInvitation({ organizationId: "org1", email: " Owner@Salon.TEST ", createdById: "admin1", now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(db.tx.invitation.updateMany).toHaveBeenCalledWith({
      where: { organizationId: "org1", email: "owner@salon.test", acceptedAt: null, revokedAt: null },
      data: { revokedAt: NOW },
    });
    const data = db.tx.invitation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: "owner@salon.test", role: "admin", tokenHash: hashInviteToken(r.token) });
    expect(data.expiresAt.getTime() - NOW.getTime()).toBe(INVITE_DAYS * 86_400_000);
  });

  it("refuses an address that already has a login", async () => {
    db.user.findUnique.mockResolvedValue({ organizationId: "other" });
    expect(await createInvitation({ organizationId: "org1", email: "owner@salon.test" })).toMatchObject({ ok: false, status: 409 });
    expect(db.tx.invitation.create).not.toHaveBeenCalled();
  });

  it("refuses a bad address or role, and a salon that is not there", async () => {
    expect(await createInvitation({ organizationId: "org1", email: "nope" })).toMatchObject({ status: 400 });
    expect(await createInvitation({ organizationId: "org1", email: "a@b.co", role: "superAdmin" })).toMatchObject({ status: 400 });
    db.organization.findUnique.mockResolvedValue(null);
    expect(await createInvitation({ organizationId: "org1", email: "a@b.co" })).toMatchObject({ status: 404 });
  });
});

describe("readInvitation", () => {
  it("shows the address and salon of a usable link", async () => {
    expect(await readInvitation(TOKEN, NOW)).toEqual({ ok: true, email: "owner@salon.test", salon: "Salon" });
    expect(db.invitation.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashInviteToken(TOKEN) });
  });

  it("says why a link no longer works", async () => {
    db.invitation.findUnique.mockResolvedValue(stored({ acceptedAt: NOW }));
    expect(await readInvitation(TOKEN, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("already been used") });
    db.invitation.findUnique.mockResolvedValue(stored({ expiresAt: NOW }));
    expect(await readInvitation(TOKEN, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
    db.invitation.findUnique.mockResolvedValue(null);
    expect(await readInvitation(TOKEN, NOW)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("acceptInvitation", () => {
  it("makes the login in the salon with the invited role, and uses the link up", async () => {
    expect(await acceptInvitation({ token: TOKEN, name: " Sam ", password: "longenough", now: NOW })).toEqual({
      ok: true,
      email: "owner@salon.test",
    });
    expect(db.tx.invitation.updateMany).toHaveBeenCalledWith({
      where: { id: "inv1", acceptedAt: null, revokedAt: null },
      data: { acceptedAt: NOW },
    });
    expect(db.tx.user.create.mock.calls[0][0].data).toMatchObject({
      email: "owner@salon.test",
      name: "Sam",
      role: "admin",
      organizationId: "org1",
      passwordHash: "hashed:longenough",
    });
  });

  it("asks for a name and a long enough password", async () => {
    expect(await acceptInvitation({ token: TOKEN, name: "", password: "longenough" })).toMatchObject({ status: 400 });
    expect(await acceptInvitation({ token: TOKEN, name: "Sam", password: "short" })).toMatchObject({ status: 400 });
    expect(db.tx.user.create).not.toHaveBeenCalled();
  });

  it("makes one login however many times it is clicked", async () => {
    db.tx.invitation.updateMany.mockResolvedValue({ count: 0 });
    expect(await acceptInvitation({ token: TOKEN, name: "Sam", password: "longenough", now: NOW })).toMatchObject({ status: 410 });
    expect(db.tx.user.create).not.toHaveBeenCalled();
  });

  it("leaves the link alone when the address got a login meanwhile", async () => {
    db.tx.user.findUnique.mockResolvedValue({ id: "u1" });
    expect(await acceptInvitation({ token: TOKEN, name: "Sam", password: "longenough", now: NOW })).toMatchObject({ status: 409 });
    expect(db.tx.invitation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a used, withdrawn or old link", async () => {
    for (const over of [{ acceptedAt: NOW }, { revokedAt: NOW }, { expiresAt: NOW }]) {
      db.tx.invitation.findUnique.mockResolvedValue(stored(over));
      expect(await acceptInvitation({ token: TOKEN, name: "Sam", password: "longenough", now: NOW })).toMatchObject({ ok: false, status: 410 });
    }
    expect(db.tx.user.create).not.toHaveBeenCalled();
  });
});
