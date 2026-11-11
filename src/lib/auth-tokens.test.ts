import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reset and confirm links: hashed, one use, short-lived; a reset signs every
 * device out and never says whether an address has a login.
 */

const db = vi.hoisted(() => ({
  authToken: { updateMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async (p: string) => `hashed:${p}`),
  validatePassword: (p: string) => (p.length < 8 ? "Password must be at least 8 characters" : null),
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendEmail: mail.sendEmail }));

import {
  LIFETIME_MS,
  consumeAuthToken,
  hashAuthToken,
  issueAuthToken,
  newAuthToken,
  requestPasswordReset,
  resetPassword,
  sendVerification,
  verifyEmail,
} from "./auth-tokens";

const NOW = new Date("2026-11-11T12:00:00Z");
const { token: TOKEN } = newAuthToken();
const row = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  userId: "u1",
  purpose: "reset",
  usedAt: null,
  expiresAt: new Date(NOW.getTime() + 60_000),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.authToken.findUnique.mockResolvedValue(row());
  db.authToken.updateMany.mockResolvedValue({ count: 1 });
  db.user.findUnique.mockResolvedValue({ id: "u1", role: "admin", email: "a@b.co", emailVerified: null });
  db.user.update.mockResolvedValue({ email: "a@b.co" });
  mail.sendEmail.mockResolvedValue({ ok: true, id: "e1" });
});

describe("issueAuthToken", () => {
  it("stores only the hash, for the kind's lifetime, and ends any open one", async () => {
    const token = await issueAuthToken("u1", "reset", NOW);
    expect(db.authToken.updateMany).toHaveBeenCalledWith({ where: { userId: "u1", purpose: "reset", usedAt: null }, data: { usedAt: NOW } });
    const data = db.authToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashAuthToken(token));
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data.expiresAt.getTime() - NOW.getTime()).toBe(LIFETIME_MS.reset);
  });
});

describe("consumeAuthToken", () => {
  it("works once, for its own kind only, until it expires", async () => {
    expect(await consumeAuthToken(TOKEN, "reset", NOW)).toEqual({ ok: true, userId: "u1" });
    expect(await consumeAuthToken(TOKEN, "verify", NOW)).toMatchObject({ ok: false, status: 404 });
    db.authToken.findUnique.mockResolvedValue(row({ usedAt: NOW }));
    expect(await consumeAuthToken(TOKEN, "reset", NOW)).toMatchObject({ ok: false, status: 410 });
    db.authToken.findUnique.mockResolvedValue(row({ expiresAt: NOW }));
    expect(await consumeAuthToken(TOKEN, "reset", NOW)).toMatchObject({ ok: false, status: 410 });
  });

  it("loses a race to a second click rather than working twice", async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 0 });
    expect(await consumeAuthToken(TOKEN, "reset", NOW)).toMatchObject({ ok: false, status: 410 });
  });

  it("refuses something that is not a token at all", async () => {
    expect(await consumeAuthToken("short", "reset", NOW)).toMatchObject({ status: 404 });
    expect(db.authToken.findUnique).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset", () => {
  it("emails a link to the reset page for a login", async () => {
    await requestPasswordReset(" A@B.co ", "https://app.test");
    const sent = mail.sendEmail.mock.calls[0][0];
    expect(sent.to).toBe("a@b.co");
    expect(sent.text).toMatch(/https:\/\/app\.test\/reset-password\/[A-Za-z0-9_-]{43}/);
  });

  it("sends nothing for an address with no login, or a withdrawn one", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await requestPasswordReset("nobody@b.co", "https://app.test");
    db.user.findUnique.mockResolvedValue({ id: "u2", role: "stylist" });
    await requestPasswordReset("old@b.co", "https://app.test");
    expect(mail.sendEmail).not.toHaveBeenCalled();
    expect(db.authToken.create).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  it("sets the password, signs every device out, and counts the address as confirmed", async () => {
    expect(await resetPassword(TOKEN, "longenough", NOW)).toEqual({ ok: true, email: "a@b.co" });
    expect(db.user.update.mock.calls[0][0].data).toEqual({
      passwordHash: "hashed:longenough",
      sessionVersion: { increment: 1 },
      emailVerified: NOW,
    });
  });

  it("checks the password before using the link up", async () => {
    expect(await resetPassword(TOKEN, "short", NOW)).toMatchObject({ status: 400 });
    expect(db.authToken.updateMany).not.toHaveBeenCalled();
  });
});

describe("confirming an email", () => {
  it("sends a confirm link, unless it is confirmed already", async () => {
    expect(await sendVerification("u1", "https://app.test")).toEqual({ ok: true });
    expect(mail.sendEmail.mock.calls[0][0].text).toMatch(/\/verify-email\//);
    db.user.findUnique.mockResolvedValue({ email: "a@b.co", emailVerified: NOW });
    expect(await sendVerification("u1", "https://app.test")).toMatchObject({ status: 409 });
  });

  it("marks the address confirmed from the link", async () => {
    db.authToken.findUnique.mockResolvedValue(row({ purpose: "verify" }));
    expect(await verifyEmail(TOKEN, NOW)).toEqual({ ok: true, email: "a@b.co" });
    expect(db.user.update.mock.calls[0][0].data).toEqual({ emailVerified: NOW });
  });
});
