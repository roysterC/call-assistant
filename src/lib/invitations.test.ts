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
    invitation: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn(), available: true }));
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: mail.sendEmail,
  emailAvailable: () => mail.available,
}));
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
  invitationEmail,
  renewExpiredInvitation,
  remindStalledInvitations,
  REMIND_AFTER_DAYS,
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
    delivery: "link",
    language: "en",
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
  mail.sendEmail.mockResolvedValue({ ok: true, id: "e1" });
  mail.available = true;
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

  it("records how it is delivered: a link to copy unless it is emailed", async () => {
    await createInvitation({ organizationId: "org1", email: "a@b.co", now: NOW });
    await createInvitation({ organizationId: "org1", email: "a@b.co", delivery: "email", now: NOW });
    expect(db.tx.invitation.create.mock.calls.map((c) => c[0].data.delivery)).toEqual(["link", "email"]);
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
    expect(await readInvitation(TOKEN, NOW)).toEqual({
      ok: true,
      email: "owner@salon.test",
      salon: "Salon",
      role: "admin",
      language: "en",
    });
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
      name: "Sam",
      role: "admin",
      organizationId: "org1",
      salon: "Salon",
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

  it("counts the address as confirmed only for an invite the app emailed", async () => {
    await acceptInvitation({ token: TOKEN, name: "Sam", password: "longenough", now: NOW });
    expect(db.tx.user.create.mock.calls[0][0].data.emailVerified).toBeNull();
    db.tx.invitation.findUnique.mockResolvedValue(stored({ delivery: "email" }));
    await acceptInvitation({ token: TOKEN, name: "Sam", password: "longenough", now: NOW });
    expect(db.tx.user.create.mock.calls[1][0].data.emailVerified).toEqual(NOW);
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

describe("invitationEmail", () => {
  it("is written in the invitation's language, with Kikai's note first", () => {
    const vi = invitationEmail({ to: "a@b.co", link: "https://x/invite/t", salon: "Mai Nails", role: "admin", lang: "vi", note: "Chào chị Mai!" });
    expect(vi.subject).toBe("Lời mời tham gia Mai Nails trên Kikai");
    expect(vi.text.indexOf("Chào chị Mai!")).toBeLessThan(vi.text.indexOf("Kikai đã sẵn sàng"));
    expect(vi.html).toContain('lang="vi"');
    const en = invitationEmail({ to: "a@b.co", link: "https://x/invite/t", salon: "Shears", role: "member" });
    expect(en.subject).toBe("You're invited to Shears on Kikai");
    expect(en.text).toContain("Make my login: https://x/invite/t");
  });

  it("says when it is a reminder", () => {
    const r = invitationEmail({ to: "a@b.co", link: "l", salon: "Shears", role: "admin", reminder: true });
    expect(r.subject).toBe("Your login for Shears is waiting");
  });
});

describe("createInvitation", () => {
  it("keeps the language and a trimmed note, and a reminder is marked as one", async () => {
    await createInvitation({ organizationId: "org1", email: "a@b.co", language: "vi", note: "  Hi!  ", reminder: true, now: NOW });
    expect(db.tx.invitation.create.mock.calls[0][0].data).toMatchObject({ language: "vi", note: "Hi!", remindedAt: NOW });
    await createInvitation({ organizationId: "org1", email: "a@b.co", language: "fr", note: "   " });
    expect(db.tx.invitation.create.mock.calls[1][0].data).toMatchObject({ language: "en", note: null, remindedAt: null });
  });
});

describe("renewExpiredInvitation", () => {
  const expired = () => stored({ expiresAt: NOW, note: null });
  it("emails a fresh link to the same address, for an expired link only", async () => {
    db.invitation.findUnique.mockResolvedValueOnce(expired()).mockResolvedValue({ language: "en", note: null, organization: { name: "Salon" } });
    expect(await renewExpiredInvitation(TOKEN, "https://x", new Date(NOW.getTime() + 1))).toBe(true);
    expect(mail.sendEmail.mock.calls[0][0].to).toBe("owner@salon.test");
  });

  it("does nothing for a withdrawn or used link, or without email", async () => {
    for (const over of [{ revokedAt: NOW, expiresAt: NOW }, { acceptedAt: NOW, expiresAt: NOW }]) {
      db.invitation.findUnique.mockResolvedValueOnce(stored(over));
      expect(await renewExpiredInvitation(TOKEN, "https://x", new Date(NOW.getTime() + 1))).toBe(false);
    }
    mail.available = false;
    expect(await renewExpiredInvitation(TOKEN, "https://x")).toBe(false);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});

describe("remindStalledInvitations", () => {
  it("looks only for emailed, open, unreminded invites old enough", async () => {
    db.invitation.findMany.mockResolvedValue([]);
    await remindStalledInvitations("https://x", NOW);
    const where = db.invitation.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ delivery: "email", acceptedAt: null, revokedAt: null, remindedAt: null });
    expect(where.createdAt.lte.getTime()).toBe(NOW.getTime() - REMIND_AFTER_DAYS * 86_400_000);
    expect(where.expiresAt.gt).toEqual(NOW);
  });

  it("sends each one a reminder with a fresh link", async () => {
    db.invitation.findMany.mockResolvedValue([{ organizationId: "org1", email: "a@b.co", role: "admin", language: "en", note: null, createdById: null }]);
    db.invitation.findUnique.mockResolvedValue({ language: "en", note: null, organization: { name: "Salon" } });
    expect(await remindStalledInvitations("https://x", NOW)).toEqual({ sent: 1, failed: 0 });
    expect(db.tx.invitation.create.mock.calls[0][0].data.remindedAt).toBeInstanceOf(Date);
    expect(mail.sendEmail.mock.calls[0][0].subject).toBe("Your login for Salon is waiting");
  });
});
