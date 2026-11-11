/**
 * One-time links emailed to a login's own address:
 *
 *   reset   "Forgot password?": choose a new one. An hour.
 *   verify  confirm the address is theirs. A day.
 *
 * Like invitations (invitations.ts), the token is 256 random bits and only
 * its SHA-256 is stored; each works once, and a new one of the same kind
 * replaces any still open. Asking for a reset never says whether the address
 * has a login, so the form cannot be used to find out who uses Kikai.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePassword } from "@/lib/password";
import { isTenantRole } from "@/lib/tenant-roles";
import { normaliseEmail } from "@/lib/invitations";
import { actionEmail, sendEmail } from "@/lib/email";
import { DEFAULT_LANG, isLang, translate, type Lang } from "@/lib/i18n";

/** A login's own language for its emails: theirs if chosen, English otherwise. */
function langOf(language: string | null | undefined): Lang {
  return isLang(language) ? language : DEFAULT_LANG;
}

export type AuthPurpose = "reset" | "verify";

export const LIFETIME_MS: Record<AuthPurpose, number> = {
  reset: 60 * 60 * 1000,
  verify: 24 * 60 * 60 * 1000,
};

export function newAuthToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashAuthToken(token) };
}

export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeAuthToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** A new link of this kind for the login; any still open stops working. */
export async function issueAuthToken(userId: string, purpose: AuthPurpose, now: Date = new Date()): Promise<string> {
  const { token, tokenHash } = newAuthToken();
  await prisma.$transaction([
    prisma.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } }),
    prisma.authToken.create({
      data: { userId, purpose, tokenHash, expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]) },
    }),
  ]);
  return token;
}

/** `code` says why, for the page to put in the reader's language. */
type Fail = { ok: false; status: number; error: string; code?: "invalid" | "gone" | "weak" | "confirmed" | "send" };

const GONE: Record<AuthPurpose, string> = {
  reset: "This link has expired or been used. Ask for a new one.",
  verify: "This link has expired or been used. Send a new one from your Account page.",
};

/**
 * Use a link up: whose it is, or why not. Claimed by a conditional update, so
 * it works once however many times it is opened.
 */
export async function consumeAuthToken(
  token: unknown,
  purpose: AuthPurpose,
  now: Date = new Date()
): Promise<{ ok: true; userId: string } | Fail> {
  if (!looksLikeAuthToken(token)) return { ok: false, status: 404, error: "This link is not valid.", code: "invalid" };
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hashAuthToken(token) },
    select: { id: true, userId: true, purpose: true, usedAt: true, expiresAt: true },
  });
  if (!row || row.purpose !== purpose) return { ok: false, status: 404, error: "This link is not valid.", code: "invalid" };
  if (row.usedAt || row.expiresAt.getTime() <= now.getTime()) return { ok: false, status: 410, error: GONE[purpose], code: "gone" };
  const claimed = await prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (claimed.count !== 1) return { ok: false, status: 410, error: GONE[purpose], code: "gone" };
  return { ok: true, userId: row.userId };
}

/** Whether a link is still good, without using it: for the page to show the form or say why not. */
export async function checkAuthToken(token: unknown, purpose: AuthPurpose, now: Date = new Date()): Promise<Fail | null> {
  if (!looksLikeAuthToken(token)) return { ok: false, status: 404, error: "This link is not valid.", code: "invalid" };
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hashAuthToken(token) },
    select: { purpose: true, usedAt: true, expiresAt: true },
  });
  if (!row || row.purpose !== purpose) return { ok: false, status: 404, error: "This link is not valid.", code: "invalid" };
  if (row.usedAt || row.expiresAt.getTime() <= now.getTime()) return { ok: false, status: 410, error: GONE[purpose], code: "gone" };
  return null;
}

// ─── Forgot password ──────────────────────────────────────────────────────

/**
 * Email a reset link if the address has a login that can sign in. Says
 * nothing either way: the caller answers "if it has a login, we've sent a
 * link" whatever happened.
 */
export async function requestPasswordReset(email: unknown, origin: string): Promise<void> {
  const address = normaliseEmail(email);
  if (!address) return;
  const user = await prisma.user.findUnique({ where: { email: address }, select: { id: true, role: true, language: true } });
  if (!user || !isTenantRole(user.role || "member")) return;
  const token = await issueAuthToken(user.id, "reset");
  const lang = langOf(user.language);
  await sendEmail(
    actionEmail({
      to: address,
      subject: translate(lang, "mail.reset.subject"),
      heading: translate(lang, "mail.reset.heading"),
      lines: [translate(lang, "mail.reset.line")],
      button: translate(lang, "mail.reset.button"),
      url: `${origin}/reset-password/${token}`,
      footer: translate(lang, "mail.reset.footer"),
      copyLine: translate(lang, "mail.copy"),
      lang,
    })
  );
}

/**
 * Set the new password. Every device signed in with the old one is signed
 * out (sessionVersion), and the address counts as confirmed: the link was
 * opened from its inbox.
 */
export async function resetPassword(
  token: unknown,
  password: unknown,
  now: Date = new Date()
): Promise<{ ok: true; email: string } | Fail> {
  const plain = typeof password === "string" ? password : "";
  const weak = validatePassword(plain);
  if (weak) return { ok: false, status: 400, error: weak, code: "weak" };
  const passwordHash = await hashPassword(plain);
  const used = await consumeAuthToken(token, "reset", now);
  if (!used.ok) return used;
  const user = await prisma.user.findUnique({ where: { id: used.userId }, select: { emailVerified: true } });
  const updated = await prisma.user.update({
    where: { id: used.userId },
    data: {
      passwordHash,
      sessionVersion: { increment: 1 },
      ...(user?.emailVerified ? {} : { emailVerified: now }),
    },
    select: { email: true },
  });
  return { ok: true, email: updated.email };
}

// ─── Confirming the address ───────────────────────────────────────────────

export async function sendVerification(userId: string, origin: string): Promise<{ ok: true } | Fail> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true, language: true } });
  if (!user) return { ok: false, status: 404, error: "Login not found" };
  if (user.emailVerified) return { ok: false, status: 409, error: "Your email is already confirmed." };
  const token = await issueAuthToken(userId, "verify");
  const lang = langOf(user.language);
  const sent = await sendEmail(
    actionEmail({
      to: user.email,
      subject: translate(lang, "mail.verify.subject"),
      heading: translate(lang, "mail.verify.heading"),
      lines: [translate(lang, "mail.verify.line")],
      button: translate(lang, "mail.verify.button"),
      url: `${origin}/verify-email/${token}`,
      footer: translate(lang, "mail.verify.footer"),
      copyLine: translate(lang, "mail.copy"),
      lang,
    })
  );
  return sent.ok ? { ok: true } : { ok: false, status: 502, error: sent.error };
}

export async function verifyEmail(token: unknown, now: Date = new Date()): Promise<{ ok: true; email: string } | Fail> {
  const used = await consumeAuthToken(token, "verify", now);
  if (!used.ok) return used;
  const updated = await prisma.user.update({
    where: { id: used.userId },
    data: { emailVerified: now },
    select: { email: true },
  });
  return { ok: true, email: updated.email };
}
