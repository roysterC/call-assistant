import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { INVITATION_FIELDS, createInvitation, emailInvitation } from "@/lib/invitations";
import { emailAvailable } from "@/lib/email";
import { linkOrigin } from "@/lib/app-origin";

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
  // Whether the screen can offer "Email it", or only a link to copy.
  return NextResponse.json({ invitations, canEmail: emailAvailable() });
}

/**
 * Invite someone: { email, role?, delivery? } (role "admin", the owner, by
 * default). delivery "email" (the default where email is set up) sends it
 * and never returns the link; "link" returns the token, once, for the screen
 * to make the link from.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id: organizationId } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const base = { organizationId, email: body?.email, role: body?.role, createdById: ctx.userId };
    if ((body?.delivery ?? (emailAvailable() ? "email" : "link")) === "email") {
      const sent = await emailInvitation({ ...base, origin: linkOrigin(req.nextUrl.origin) });
      if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status });
      return NextResponse.json({ invitation: sent.invitation, emailed: true });
    }
    const result = await createInvitation(base);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ invitation: result.invitation, token: result.token });
  } catch (error) {
    console.error("[ADMIN INVITATIONS] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
