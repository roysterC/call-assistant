import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { devBypassEnabled } from "@/lib/dev-bypass";
import { isCurrentSession } from "@/lib/session-version";
import { isTenantRole, type TenantRole } from "@/lib/tenant-roles";

export { TENANT_ROLES, isTenantRole, type TenantRole } from "@/lib/tenant-roles";

export type TenantContext = {
  userId: string;
  organizationId: string;
  role: TenantRole;
  isSuperAdmin: boolean;
};

export interface TenantOptions {
  /**
   * Let members (the salon's staff) through. Every route is for the owner
   * (admin) unless it says otherwise, so a route added later is owner-only
   * until someone decides staff should have it. Day-to-day work — the diary,
   * clients, calls, conversations, takings — opens itself to members; the
   * salon's setup, its websites and chatbot, and what it pays do not.
   * src/lib/route-access.test.ts holds the list.
   */
  members?: boolean;
}

/**
 * Local dev escape hatch — when DEV_BYPASS_AUTH=1 is set (via .env.local),
 * skip real session lookups and return a mock super-admin context pointing
 * at the seeded Kikai org (slug "doai"). Only activates if that org exists in
 * the DB, and never in a production build (see dev-bypass.ts).
 */
async function devBypassTenant(
  req: Request
): Promise<TenantContext | null> {
  if (!devBypassEnabled()) return null;
  const org = await prisma.organization.findUnique({
    where: { slug: "doai" },
    select: { id: true },
  });
  if (!org) return null;
  const url = new URL(req.url);
  const asOrg = url.searchParams.get("asOrg");
  return {
    userId: "dev-user",
    organizationId: asOrg || org.id,
    role: "superAdmin",
    isSuperAdmin: true,
  };
}

/**
 * Require a valid session and resolve the target organizationId.
 *
 * - Regular users: uses session.user.organizationId
 * - Super-admins:
 *    - If ?asOrg=<id> is provided → uses that org
 *    - Otherwise → must also have their own organizationId (the Kikai org, slug "doai")
 *
 * Returns an NextResponse error on failure.
 */
export async function requireTenant(
  req: Request,
  opts: TenantOptions = {}
): Promise<TenantContext | NextResponse> {
  const dev = await devBypassTenant(req);
  if (dev) return dev;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The session says who signed in; the database says what they may do now.
  // Read on every request so a removed login or a changed permission takes
  // effect at once rather than when the session cookie expires.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      organizationId: true,
      sessionVersion: true,
    },
  });
  if (!user || !isCurrentSession(session.user.sessionVersion, user.sessionVersion)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Stylist logins were withdrawn; one left in the database must not fall
  // through to a full login. Only the roles that exist get in.
  const role = user.role || "member";
  if (!isTenantRole(role)) {
    return NextResponse.json({ error: "This login is no longer active." }, { status: 403 });
  }
  const url = new URL(req.url);
  const asOrg = url.searchParams.get("asOrg");

  if (role === "superAdmin" && asOrg) {
    return {
      userId: session.user.id,
      organizationId: asOrg,
      role,
      isSuperAdmin: true,
    };
  }

  const orgId = user.organizationId;
  if (!orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 }
    );
  }

  if (role === "member" && !opts.members) {
    return NextResponse.json(
      { error: "Only the salon's owner can do this.", code: "OWNER_ONLY" },
      { status: 403 }
    );
  }

  return {
    userId: session.user.id,
    organizationId: orgId,
    role,
    isSuperAdmin: role === "superAdmin",
  };
}

export function isErrorResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/**
 * Stronger check: must be super-admin, no asOrg override applied.
 * Used for /admin/* endpoints.
 *
 * The role is read from the database, not the login cookie: the cookie lasts
 * 30 days, and a super-admin removed or demoted must lose /admin at once.
 */
export async function requireSuperAdmin(): Promise<
  { userId: string; role: "superAdmin" } | NextResponse
> {
  if (devBypassEnabled()) {
    return { userId: "dev-user", role: "superAdmin" };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, sessionVersion: true },
  });
  if (!user || !isCurrentSession(session.user.sessionVersion, user.sessionVersion)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "superAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId: session.user.id, role: "superAdmin" };
}
