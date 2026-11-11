/**
 * Invitations: how a salon's owner gets their own login.
 *
 * Kikai creates the salon, invites the owner by email, and sends them the
 * link itself (there is no email from the app yet: WhatsApp or email from
 * Kikai's own account). The owner opens it, chooses their name and a
 * password, and is signed in to their salon, where onboarding takes them
 * through setting it up. Nobody passes passwords around.
 *
 * The link carries a long random token. Only its SHA-256 is stored, so a copy
 * of the database cannot be used to sign up, and the link itself is shown
 * once, when it is made. It works once, for INVITE_DAYS. A new link for the
 * same person replaces the old one.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, validatePassword } from "@/lib/password";
import { isAssignableRole, type AssignableRole } from "@/lib/admin-users";
import { INVITE_DAYS, inviteStatus } from "@/lib/invite-status";
import { actionEmail, sendEmail, type Email } from "@/lib/email";

export { INVITE_DAYS, inviteStatus, type InviteStatus } from "@/lib/invite-status";

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

/** What the admin screens are sent about an invitation. Never the hash. */
export const INVITATION_FIELDS = {
  id: true,
  delivery: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

type Fail = { ok: false; status: number; error: string };

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
  now?: Date;
}): Promise<
  | { ok: true; token: string; invitation: { id: string; email: string; role: string; expiresAt: Date } }
  | Fail
> {
  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, status: 400, error: "That email address does not look right." };
  const role: AssignableRole = input.role === undefined ? "admin" : (input.role as AssignableRole);
  if (!isAssignableRole(role)) return { ok: false, status: 400, error: "role must be admin or member" };

  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { id: true } });
  if (!org) return { ok: false, status: 404, error: "Organisation not found" };

  const existing = await prisma.user.findUnique({ where: { email }, select: { organizationId: true } });
  if (existing) {
    return {
      ok: false,
      status: 409,
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
        expiresAt: new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000),
        createdById: input.createdById ?? null,
        delivery: input.delivery ?? "link",
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
): Promise<{ ok: true; email: string; salon: string } | Fail> {
  if (!looksLikeInviteToken(token)) return { ok: false, status: 404, error: "This link is not valid." };
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      acceptedAt: true,
      revokedAt: true,
      expiresAt: true,
      organization: { select: { name: true, enabled: true } },
    },
  });
  return checkUsable(inv, now) ?? { ok: true, email: inv!.email, salon: inv!.organization.name };
}

function checkUsable(
  inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date; organization: { enabled: boolean } } | null,
  now: Date
): Fail | null {
  if (!inv) return { ok: false, status: 404, error: "This link is not valid." };
  switch (inviteStatus(inv, now)) {
    case "accepted":
      return { ok: false, status: 410, error: "This link has already been used. Sign in instead." };
    case "revoked":
      return { ok: false, status: 410, error: "This link has been replaced. Ask Kikai for a new one." };
    case "expired":
      return { ok: false, status: 410, error: "This link has expired. Ask Kikai for a new one." };
  }
  if (!inv.organization.enabled) return { ok: false, status: 410, error: "This salon is not active." };
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
  now?: Date;
}): Promise<{ ok: true; email: string } | Fail> {
  const now = input.now ?? new Date();
  if (!looksLikeInviteToken(input.token)) return { ok: false, status: 404, error: "This link is not valid." };
  const name = String(input.name ?? "").trim().slice(0, 100);
  if (!name) return { ok: false, status: 400, error: "Enter your name." };
  const password = typeof input.password === "string" ? input.password : "";
  const weak = validatePassword(password);
  if (weak) return { ok: false, status: 400, error: weak };
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
        organizationId: true,
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
        organization: { select: { enabled: true } },
      },
    });
    const unusable = checkUsable(inv, now);
    if (unusable) return unusable;
    // Before the claim, so a refusal leaves the link as it was.
    const taken = await tx.user.findUnique({ where: { email: inv!.email }, select: { id: true } });
    if (taken) {
      return { ok: false as const, status: 409, error: "That email already has a login. Sign in instead." };
    }
    const claimed = await tx.invitation.updateMany({
      where: { id: inv!.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      return { ok: false as const, status: 410, error: "This link has already been used. Sign in instead." };
    }
    await tx.user.create({
      data: {
        email: inv!.email,
        name,
        role: isAssignableRole(inv!.role) ? inv!.role : "member",
        organizationId: inv!.organizationId,
        passwordHash,
        // Proven only by a link the app emailed to the address. A link Kikai
        // copied and passed on could have been opened by anyone, whatever
        // address it names; they confirm it from Account later.
        emailVerified: inv!.delivery === "email" ? now : null,
      },
    });
    return { ok: true as const, email: inv!.email };
  });
}

export type InviteDelivery = "email" | "link";

/** The invitation email: who it is from, what for, and the button. */
export function invitationEmail(input: { to: string; link: string; salon: string; role: string }): Email {
  const owner = input.role === "admin";
  return actionEmail({
    to: input.to,
    subject: `You're invited to ${input.salon} on Kikai`,
    heading: owner ? `Set up ${input.salon} on Kikai` : `Join ${input.salon} on Kikai`,
    lines: owner
      ? [
          "Kikai is ready for your salon. Make your login, then we'll take you through your opening hours, services and team: it takes a few minutes.",
        ]
      : [`You've been given a login for ${input.salon}'s diary on Kikai. Choose your password to start.`],
    button: "Make my login",
    url: input.link,
    footer: `This link works once, for ${INVITE_DAYS} days. If you weren't expecting it, you can ignore this email.`,
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
  origin: string;
}): Promise<{ ok: true; invitation: { id: string; email: string; role: string; expiresAt: Date } } | Fail> {
  const made = await createInvitation({ ...input, delivery: "email" });
  if (!made.ok) return made;
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
  const sent = await sendEmail(
    invitationEmail({
      to: made.invitation.email,
      link: `${input.origin}/invite/${made.token}`,
      salon: org?.name ?? "your salon",
      role: made.invitation.role,
    })
  );
  if (!sent.ok) {
    await prisma.invitation.update({ where: { id: made.invitation.id }, data: { revokedAt: new Date() } });
    return { ok: false, status: 502, error: `${sent.error} Copy a link to send instead.` };
  }
  return { ok: true, invitation: made.invitation };
}
