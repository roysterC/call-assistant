import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { emailAvailable } from "@/lib/email";
import { createInvitation, emailInvitation, INVITATION_FIELDS } from "@/lib/invitations";
import { linkOrigin } from "@/lib/app-origin";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The salon's logins, for its owner (Settings → Team logins): who can sign in,
 * and staff invited but not joined yet. An owner invites staff only; making
 * another owner stays with Kikai (Admin). Invitations go by email where it is
 * set up. Where it isn't, or an email didn't go, the owner gets the link to
 * pass on themselves (by text or WhatsApp), shown once.
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

/**
 * { email, language?, delivery? }: invite a member of staff. "email" (the
 * default where email is set up) sends the link and never returns it. "link"
 * (the only way while email isn't set up) returns it, once, for the owner to
 * send; a login made from it doesn't count as a confirmed email.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const { allowed } = rateLimit("team-invite", ctx.organizationId, { tokens: 20, refillPerSecond: 1 / 180 });
  if (!allowed) return NextResponse.json({ error: "Too many invitations at once. Try again later.", code: "tooMany" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const origin = linkOrigin(req.nextUrl.origin);
  const base = {
    organizationId: ctx.organizationId,
    email: body?.email,
    role: "member",
    createdById: ctx.userId === "dev-user" ? null : ctx.userId,
    language: body?.language,
  };
  if (body?.delivery !== "link" && emailAvailable()) {
    const sent = await emailInvitation({ ...base, origin });
    if (!sent.ok) return NextResponse.json({ error: sent.error, code: sent.code }, { status: sent.status });
    return NextResponse.json({ invitation: sent.invitation });
  }
  const made = await createInvitation({ ...base, delivery: "link" });
  if (!made.ok) return NextResponse.json({ error: made.error, code: made.code }, { status: made.status });
  return NextResponse.json({ invitation: made.invitation, link: `${origin}/invite/${made.token}` });
}
