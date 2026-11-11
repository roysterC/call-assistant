import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { INVITATION_FIELDS, createInvitation } from "@/lib/invitations";

/** The salon's invitations, newest first. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id: organizationId } = await params;
  const invitations = await prisma.invitation.findMany({
    where: { organizationId },
    select: INVITATION_FIELDS,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ invitations });
}

/**
 * Invite someone: { email, role? } (role "admin", the owner, by default).
 * The response carries the token, once; the link is made from it on screen.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id: organizationId } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await createInvitation({
      organizationId,
      email: body?.email,
      role: body?.role,
      createdById: ctx.userId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ invitation: result.invitation, token: result.token });
  } catch (error) {
    console.error("[ADMIN INVITATIONS] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
