import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { createInvitation, emailInvitation } from "@/lib/invitations";
import { emailAvailable } from "@/lib/email";
import { linkOrigin } from "@/lib/app-origin";

type Params = { params: Promise<{ id: string; inviteId: string }> };

async function find(organizationId: string, inviteId: string) {
  return prisma.invitation.findFirst({
    where: { id: inviteId, organizationId },
    select: { id: true, email: true, role: true, acceptedAt: true, language: true, note: true },
  });
}

/**
 * A new link for the same person, replacing the old one (which stops
 * working): { delivery? } "email" to send it again, "link" to copy one.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id: organizationId, inviteId } = await params;
  const inv = await find(organizationId, inviteId);
  if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (inv.acceptedAt) return NextResponse.json({ error: "That invitation has been used." }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const base = {
    organizationId,
    email: inv.email,
    role: inv.role,
    createdById: ctx.userId,
    language: inv.language,
    note: inv.note,
  };
  if ((body?.delivery ?? (emailAvailable() ? "email" : "link")) === "email") {
    const sent = await emailInvitation({ ...base, origin: linkOrigin(req.nextUrl.origin) });
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status });
    return NextResponse.json({ invitation: sent.invitation, emailed: true });
  }
  const result = await createInvitation(base);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ invitation: result.invitation, token: result.token });
}

/** Withdraw it: the link stops working. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id: organizationId, inviteId } = await params;
  const inv = await find(organizationId, inviteId);
  if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (inv.acceptedAt) return NextResponse.json({ error: "That invitation has been used." }, { status: 409 });
  await prisma.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
