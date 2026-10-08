/**
 * The roles a login may have. Kept apart from tenant.ts so sign-in (auth.ts,
 * which tenant.ts imports) can check them too.
 *
 * Stylist logins were withdrawn: a "stylist" row left in the database is not
 * a role, so it can neither sign in nor reach any route.
 */
export type TenantRole = "member" | "admin" | "superAdmin";

export const TENANT_ROLES: readonly TenantRole[] = ["member", "admin", "superAdmin"];

export function isTenantRole(role: unknown): role is TenantRole {
  return TENANT_ROLES.includes(role as TenantRole);
}
