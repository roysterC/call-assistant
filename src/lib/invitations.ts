/**
 * Invitations: how a salon's owner, or its staff, get their own login.
 *
 * Kikai speaks to the owner, creates the salon, and invites them: the app
 * emails a link (in their language, with a note from Kikai at the top), or,
 * where email is not set up, Kikai copies a link and passes it on. They open
 * it, choose their name and a password, and are signed in to their salon,
 * where onboarding takes the owner through setting it up. Owners invite their
 * own staff the same way, from Settings.
 *
 * The link carries a long random token. Only its SHA-256 is stored, so a copy
 * of the database cannot be used to sign up, and the link itself is never
 * shown to anyone once emailed. It works once, for INVITE_DAYS. A new link
 * for the same person replaces the old one. An emailed invite not used after
 * REMIND_AFTER_DAYS gets one reminder with a fresh link, and an expired one
 * can ask for a new link from its own page, sent to the same address.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePassword } from "@/lib/password";
import { isAssignableRole, type AssignableRole } from "@/lib/admin-users";
import { INVITE_DAYS, inviteStatus } from "@/lib/invite-status";
import { actionEmail, emailAvailable, sendEmail, type Email } from "@/lib/email";
import { DEFAULT_LANG, isLang, translate, type Lang } from "@/lib/i18n";

export { INVITE_DAYS, inviteStatus, type InviteStatus } from "@/lib/invite-status";

/** An emailed invite still unused after this long gets one reminder. */
export const REMIND_AFTER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A new token for a link, and what is stored for it. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A token as links carry it: 43 base64url characters. Anything else is not one. */
export function looksLikeInviteToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function normaliseEmail(email: unknown): string | null {
  const e = String(email ?? "").toLowerCase().trim();
  // Enough to catch a slip of the keyboard; the person proves the address
  // by opening the link.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Kikai's note in an invitation: plain text, short enough to read at a glance. */
export const NOTE_MAX = 600;
function cleanNote(note: unknown): string | null {
  const n = typeof note === "string" ? note.trim().slice(0, NOTE_MAX) : "";
  return n || null;
}

/** What the admin screens are sent about an invitation. Never the hash. */
export const INVITATION_FIELDS = {
  id: true,
  delivery: true,
  email: true,
  role: true,
  language: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  remindedAt: true,
  createdAt: true,
} as const;

export type InviteDelivery = "email" | "link";

/** Why a link cannot be used, for the page to say in the reader's language. */
export type InviteCode = "invalid" | "used" | "replaced" | "expired" | "inactive" | "taken" | "name" | "weak" | "email" | "role" | "notFound" | "send";

type Fail = { ok: false; status: number; error: string; code: InviteCode };

type Made = { id: string; email: string; role: string; expiresAt: Date };

/**
 * Invite `email` to the salon. Replaces any link still open for the same
 * person there. Refused when the address already has a login: one login
 * belongs to one salon.
 */
export async function createInvitation(input: {
  organizationId: string;
  email: unknown;
  role?: unknown;
  createdById?: string | null;
  /** "email": the app emails the link and nobody else sees it. "link": shown to Kikai to pass on. */
  delivery?: InviteDelivery;
  language?: unknown;
  note?: unknown;
  /** This one is itself the reminder, so it is not reminded again. */
  reminder?: boolean;
  now?: Date;
}): Promise<{ ok: true; token: string; invitation: Made } | Fail> {
  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, status: 400, error: "That email address does not look right.", code: "email" };
  const role: AssignableRole = input.role === undefined ? "admin" : (input.role as AssignableRole);
  if (!isAssignableRole(role)) return { ok: false, status: 400, error: "role must be admin or member", code: "role" };

  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
  if (!org) return { ok: false, status: 404, error: "Organisation not found", code: "notFound" };

  const existing = await prisma.user.findUnique({ where: { email }, select: { organizationId: true } });
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: "taken",
      error:
        existing.organizationId === input.organizationId
          ? "That person already has a login for this salon."
          : "That email already has a login elsewhere. Use a different address.",
    };
  }

  const now = input.now ?? new Date();
  const { token, tokenHash } = newInviteToken();
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { organizationId: input.organizationId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return tx.invitation.create({
      data: {
        organizationId: input.organizationId,
        email,
        role,
        tokenHash,
        expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS),
        createdById: input.createdById ?? null,
        delivery: input.delivery ?? "link",
        language: isLang(input.language) ? input.language : DEFAULT_LANG,
        note: cleanNote(input.note),
        remindedAt: input.reminder ? now : null,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
  });
  return { ok: true, token, invitation };
}

/** What the invite page shows before the person signs up. */
export async function readInvitation(
  token: unknown,
  now: Date = new Date()
): Promise<{ ok: true; email: string; salon: string; role: string; language: Lang } | Fail> {
  if (!looksLikeInviteToken(token)) return { ok: false, status: 404, error: "This link is not valid.", code: "invalid" };
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      role: true,
      language: true,
      acceptedAt: true,
      revokedAt: true,
      expiresAt: true,
      organization: { select: { name: true, enabled: true } },
    },
  });
  return (
    checkUsable(inv, now) ?? {
      ok: true,
      email: inv!.email,
      salon: inv!.organization.name,
      role: inv!.role,
      language: isLang(inv!.language) ? inv!.language : DEFAULT_LANG,
    }
  );
}

function checkUsable(
  inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date; organization: { enabled: boolean } } | null,
  now: Date
): Fail | null {
  if (!inv) return { ok: false, status: 404, error: "This link is not valid.", code: "invalid" };
  switch (inviteStatus(inv, now)) {
    case "accepted":
      return { ok: false, status: 410, error: "This link has already been used. Sign in instead.", code: "used" };
    case "revoked":
      return { ok: false, status: 410, error: "This link has been replaced or withdrawn.", code: "replaced" };
    case "expired":
      return { ok: false, status: 410, error: "This link has expired.", code: "expired" };
  }
  if (!inv.organization.enabled) return { ok: false, status: 410, error: "This salon is not active.", code: "inactive" };
  return null;
}

/**
 * Make the login the invitation is for, and use the invitation up. All in one
 * transaction, and the invitation is claimed by a conditional update, so two
 * clicks at once cannot make two logins.
 */
export async function acceptInvitation(input: {
  token: unknown;
  name: unknown;
  password: unknown;
  /** The language they had the page in: the new login starts in it. */
  language?: unknown;
  now?: Date;
}): Promise<{ ok: true; email: string; name: string; role: string; organizationId: string; salon: string } | Fail> {
  const now = input.now ?? new Date();
  if (!looksLikeInviteToken(input.token)) return { ok: false, status: 404, error: "This link is not valid.", code: "invalid" };
  const name = String(input.name ?? "").trim().slice(0, 100);
  if (!name) return { ok: false, status: 400, error: "Enter your name.", code: "name" };
  const password = typeof input.password === "string" ? input.password : "";
  const weak = validatePassword(password);
  if (weak) return { ok: false, status: 400, error: weak, code: "weak" };
  const passwordHash = await hashPassword(password);
  const tokenHash = hashInviteToken(input.token);

  return prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        role: true,
        delivery: true,
        language: true,
        organizationId: true,
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
        organization: { select: { enabled: true, name: true } },
      },
    });
    const unusable = checkUsable(inv, now);
    if (unusable) return unusable;
    // Before the claim, so a refusal leaves the link as it was.
    const taken = await tx.user.findUnique({ where: { email: inv!.email }, select: { id: true } });
    if (taken) {
      return { ok: false as const, status: 409, error: "That email already has a login. Sign in instead.", code: "taken" as const };
    }
    const claimed = await tx.invitation.updateMany({
      where: { id: inv!.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      return { ok: false as const, status: 410, error: "This link has already been used. Sign in instead.", code: "used" as const };
    }
    const role = isAssignableRole(inv!.role) ? inv!.role : "member";
    await tx.user.create({
      data: {
        email: inv!.email,
        name,
        role,
        organizationId: inv!.organizationId,
        passwordHash,
        language: isLang(input.language) ? input.language : isLang(inv!.language) ? inv!.language : null,
        // Proven only by a link the app emailed to the address. A link Kikai
        // copied and passed on could have been opened by anyone, whatever
        // address it names; they confirm it from Account later.
        emailVerified: inv!.delivery === "email" ? now : null,
      },
    });
    return {
      ok: true as const,
      email: inv!.email,
      name,
      role,
      organizationId: inv!.organizationId,
      salon: inv!.organization.name,
    };
  });
}

/** The invitation email, in `lang`: who it is for, Kikai's note if any, and the button. */
export function invitationEmail(input: {
  to: string;
  link: string;
  salon: string;
  role: string;
  lang?: Lang;
  note?: string | null;
  reminder?: boolean;
}): Email {
  const lang = input.lang ?? DEFAULT_LANG;
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, key, vars);
  const owner = input.role === "admin";
  const salon = input.salon;
  return actionEmail({
    to: input.to,
    subject: input.reminder ? t("mail.invite.reminderSubject", { salon }) : t("mail.invite.subject", { salon }),
    heading: owner ? t("mail.invite.ownerHeading", { salon }) : t("mail.invite.staffHeading", { salon }),
    lines: [
      ...(input.note ? [input.note] : []),
      ...(input.reminder ? [t("mail.invite.reminderLine", { salon })] : []),
      owner ? t("mail.invite.ownerLine") : t("mail.invite.staffLine", { salon }),
    ],
    button: t("mail.invite.button"),
    url: input.link,
    copyLine: t("mail.copy"),
    footer: t("mail.invite.footer", { days: INVITE_DAYS }),
    lang,
  });
}

/**
 * Invite by email: make the invitation and send it. If the email cannot go,
 * the invitation is withdrawn, so no link exists that nobody received.
 */
export async function emailInvitation(input: {
  organizationId: string;
  email: unknown;
  role?: unknown;
  createdById?: string | null;
  language?: unknown;
  note?: unknown;
  reminder?: boolean;
  origin: string;
}): Promise<{ ok: true; invitation: Made } | Fail> {
  const made = await createInvitation({ ...input, delivery: "email" });
  if (!made.ok) return made;
  const row = await prisma.invitation.findUnique({
    where: { id: made.invitation.id },
    select: { language: true, note: true, organization: { select: { name: true } } },
  });
  const sent = await sendEmail(
    invitationEmail({
      to: made.invitation.email,
      link: `${input.origin}/invite/${made.token}`,
      salon: row?.organization.name ?? "your salon",
      role: made.invitation.role,
      lang: isLang(row?.language) ? row.language : DEFAULT_LANG,
      note: row?.note,
      reminder: input.reminder,
    })
  );
  if (!sent.ok) {
    await prisma.invitation.update({ where: { id: made.invitation.id }, data: { revokedAt: new Date() } });
    return { ok: false, status: 502, error: `${sent.error} Copy a link to send instead.`, code: "send" };
  }
  return { ok: true, invitation: made.invitation };
}

/**
 * "Send me a new link", from an expired link's own page: a fresh one, to the
 * address the old one was for, never anywhere else. Only for a link that ran
 * out of time: a withdrawn one stays withdrawn.
 */
export async function renewExpiredInvitation(token: unknown, origin: string, now: Date = new Date()): Promise<boolean> {
  if (!looksLikeInviteToken(token) || !emailAvailable()) return false;
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      organizationId: true,
      email: true,
      role: true,
      language: true,
      note: true,
      acceptedAt: true,
      revokedAt: true,
      expiresAt: true,
      organization: { select: { enabled: true } },
    },
  });
  if (!inv || inviteStatus(inv, now) !== "expired" || !inv.organization.enabled) return false;
  const sent = await emailInvitation({
    organizationId: inv.organizationId,
    email: inv.email,
    role: inv.role,
    language: inv.language,
    note: inv.note,
    origin,
  });
  return sent.ok;
}

/**
 * One reminder for each emailed invite left unused for REMIND_AFTER_DAYS: a
 * fresh link (the old one stops working), saying it is a reminder. Run by the
 * daily timer (src/app/api/cron/invite-reminders). Never twice for the same
 * person: the new invitation is marked as the reminder.
 */
export async function remindStalledInvitations(origin: string, now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const stalled = await prisma.invitation.findMany({
    where: {
      delivery: "email",
      acceptedAt: null,
      revokedAt: null,
      remindedAt: null,
      expiresAt: { gt: now },
      createdAt: { lte: new Date(now.getTime() - REMIND_AFTER_DAYS * DAY_MS) },
      organization: { enabled: true },
    },
    select: { organizationId: true, email: true, role: true, language: true, note: true, createdById: true },
    take: 100,
  });
  let sent = 0;
  let failed = 0;
  for (const inv of stalled) {
    const r = await emailInvitation({ ...inv, reminder: true, origin });
    if (r.ok) sent++;
    else failed++;
  }
  return { sent, failed };
}
