/**
 * What a super-admin may do to a salon's logins from Admin → Organizations.
 *
 * There is no email, so nobody can reset their own forgotten password: they
 * ask, and a super-admin sets a new one here and passes it on. The same
 * screen changes a login between owner and staff, and removes one.
 *
 * Only owners and staff are managed here. A super-admin login is never
 * changed or removed from a form; a withdrawn stylist login may be moved to
 * owner or staff, or removed.
 */

import { validatePassword } from "@/lib/password";

/** The roles a login can be given here. */
export const ASSIGNABLE_ROLES = ["member", "admin"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(role: unknown): role is AssignableRole {
  return ASSIGNABLE_ROLES.includes(role as AssignableRole);
}

/** What the admin screens are sent about a login. Never the password hash. */
export const USER_FIELDS = { id: true, email: true, name: true, role: true, createdAt: true } as const;

export type UserChange =
  | { ok: true; role?: AssignableRole; password?: string }
  | { ok: false; status: number; error: string };

/**
 * Check a change to `target`, a login in the organisation being edited.
 * Returns what to apply, or why not.
 */
export function planUserChange(
  target: { role: string },
  body: { role?: unknown; password?: unknown }
): UserChange {
  if (target.role === "superAdmin") {
    return { ok: false, status: 403, error: "A super-admin login can't be changed here." };
  }
  if (body.role === undefined && body.password === undefined) {
    return { ok: false, status: 400, error: "Nothing to change." };
  }
  if (body.role !== undefined && !isAssignableRole(body.role)) {
    return { ok: false, status: 400, error: `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}` };
  }
  if (body.password !== undefined) {
    const err = typeof body.password === "string" ? validatePassword(body.password) : "Password must be text";
    if (err) return { ok: false, status: 400, error: err };
  }
  return {
    ok: true,
    ...(body.role !== undefined ? { role: body.role as AssignableRole } : {}),
    ...(body.password !== undefined ? { password: body.password as string } : {}),
  };
}

/** Whether `target` may be removed from here. */
export function canRemove(target: { role: string }): boolean {
  return target.role !== "superAdmin";
}
