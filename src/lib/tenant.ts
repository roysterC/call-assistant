import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type TenantRole = "member" | "admin" | "superAdmin" | "stylist";

/** What a stylist login may see and do. Null for every other role. */
export type StylistAccess = {
  /** Their column in the diary, by name. */
  name: string;
  diaryScope: "own" | "salon";
  canSeeTakings: boolean;
};

export type TenantContext = {
  userId: string;
  organizationId: string;
  role: TenantRole;
  isSuperAdmin: boolean;
  /** Set for a stylist login; null means full access to the salon. */
  stylist: StylistAccess | null;
};

export interface TenantOptions {
  /**
   * Let stylist logins through. Every route shuts them out unless it says
   * otherwise, so a route added later is owner-only until someone decides it
   * is safe to open — and a route that is opened must scope what it returns
   * with `ctx.stylist`.
   */
  stylists?: boolean;
  /** Let a stylist through even before they have replaced their temporary password. */
  beforePasswordChange?: boolean;
}

/**
 * Local dev escape hatch — when DEV_BYPASS_AUTH=1 is set (via .env.local),
 * skip real session lookups and return a mock super-admin context pointing
 * at the seeded Kikai org (slug "doai"). Only activates if that org exists in the DB.
 */
async function devBypassTenant(
  req: Request
): Promise<TenantContext | null> {
  if (process.env.DEV_BYPASS_AUTH !== "1") return null;
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
    stylist: null,
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
      stylistName: true,
      diaryScope: true,
      canSeeTakings: true,
      mustChangePassword: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = (user.role || "member") as TenantRole;
  const url = new URL(req.url);
  const asOrg = url.searchParams.get("asOrg");

  if (role === "superAdmin" && asOrg) {
    return {
      userId: session.user.id,
      organizationId: asOrg,
      role,
      isSuperAdmin: true,
      stylist: null,
    };
  }

  const orgId = user.organizationId;
  if (!orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 }
    );
  }

  let stylist: StylistAccess | null = null;
  if (role === "stylist") {
    if (!opts.stylists) {
      return NextResponse.json(
        { error: "Not available to stylist logins." },
        { status: 403 }
      );
    }
    if (user.mustChangePassword && !opts.beforePasswordChange) {
      return NextResponse.json(
        { error: "Choose a new password first.", code: "PASSWORD_CHANGE_REQUIRED" },
        { status: 403 }
      );
    }
    if (!user.stylistName) {
      return NextResponse.json(
        { error: "This login is not linked to a stylist." },
        { status: 403 }
      );
    }
    stylist = {
      name: user.stylistName,
      diaryScope: user.diaryScope === "own" ? "own" : "salon",
      canSeeTakings: user.canSeeTakings,
    };
  }

  return {
    userId: session.user.id,
    organizationId: orgId,
    role,
    isSuperAdmin: role === "superAdmin",
    stylist,
  };
}

/** Same person, ignoring case: stylists are referred to by name everywhere. */
export function isStylist(ctx: TenantContext, stylistName: string): boolean {
  return ctx.stylist?.name.toLowerCase() === stylistName.trim().toLowerCase();
}

/**
 * Whether this login may change the diary in `stylistName`'s column. Owners
 * may change any; a stylist only their own.
 */
export function canWriteColumn(ctx: TenantContext, stylistName: string): boolean {
  return ctx.stylist === null || isStylist(ctx, stylistName);
}

/** 403 for a stylist reaching outside their own column. */
export function notYourColumn(): NextResponse {
  return NextResponse.json(
    { error: "You can only change your own column." },
    { status: 403 }
  );
}

export function isErrorResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

/**
 * Stronger check: must be super-admin, no asOrg override applied.
 * Used for /admin/* endpoints.
 */
export async function requireSuperAdmin(): Promise<
  { userId: string; role: "superAdmin" } | NextResponse
> {
  if (process.env.DEV_BYPASS_AUTH === "1") {
    return { userId: "dev-user", role: "superAdmin" };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "superAdmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId: session.user.id, role: "superAdmin" };
}
