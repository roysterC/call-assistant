import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { createInvitation } from "@/lib/invitations";

type Params = { params: Promise<{ id: string; inviteId: string }> };

async function find(organizationId: string, inviteId: string) {
  return prisma.invitation.findFirst({
    where: { id: inviteId, organizationId },
    select: { id: true, email: true, role: true, acceptedAt: true },
  });
}

/** A new link for the same person, replacing the old one (which stops working). */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  const { id: organizationId, inviteId } = await params;
  const inv = await find(organizationId, inviteId);
  if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (inv.acceptedAt) return NextResponse.json({ error: "That invitation has been used." }, { status: 409 });
  const result = await createInvitation({ organizationId, email: inv.email, role: inv.role, createdById: ctx.userId });
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
