import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { emailAvailable } from "@/lib/email";
import { emailInvitation, INVITATION_FIELDS } from "@/lib/invitations";
import { linkOrigin } from "@/lib/app-origin";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The salon's logins, for its owner (Settings → Team logins): who can sign in,
 * and staff invited but not joined yet. An owner invites staff only, and only
 * by email, so a link never exists that nobody received; making another
 * owner stays with Kikai (Admin).
 */

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: ctx.organizationId, role: { in: ["admin", "member"] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.invitation.findMany({
      where: { organizationId: ctx.organizationId, role: "member", acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: INVITATION_FIELDS,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return NextResponse.json({
    users: users.map((u) => ({ ...u, isYou: u.id === ctx.userId })),
    invitations,
    canEmail: emailAvailable(),
  });
}

/** { email, language? }: email a staff invitation. */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  if (!emailAvailable()) {
    return NextResponse.json({ error: "Email isn't set up yet.", code: "noEmail" }, { status: 503 });
  }
  const { allowed } = rateLimit("team-invite", ctx.organizationId, { tokens: 20, refillPerSecond: 1 / 180 });
  if (!allowed) return NextResponse.json({ error: "Too many invitations at once. Try again later.", code: "tooMany" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const sent = await emailInvitation({
    organizationId: ctx.organizationId,
    email: body?.email,
    role: "member",
    createdById: ctx.userId === "dev-user" ? null : ctx.userId,
    language: body?.language,
    origin: linkOrigin(req.nextUrl.origin),
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error, code: sent.code }, { status: sent.status });
  return NextResponse.json({ invitation: sent.invitation });
}
