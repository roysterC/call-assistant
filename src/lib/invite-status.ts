/**
 * What became of an invitation, and how long a link lasts: shared by the
 * server (invitations.ts) and the admin screen, so it holds nothing that
 * cannot run in a browser.
 */

export const INVITE_DAYS = 7;

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export function inviteStatus(
  inv: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date()
): InviteStatus {
  if (inv.acceptedAt) return "accepted";
  if (inv.revokedAt) return "revoked";
  if (inv.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}
