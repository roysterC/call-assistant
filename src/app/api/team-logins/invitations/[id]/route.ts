import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { emailInvitation } from "@/lib/invitations";
import { linkOrigin } from "@/lib/app-origin";

/** A staff invitation in the owner's own salon: send it again, or withdraw it. */

type Params = { params: Promise<{ id: string }> };

async function find(organizationId: string, id: string) {
  return prisma.invitation.findFirst({
    where: { id, organizationId, role: "member", acceptedAt: null },
    select: { id: true, email: true, language: true },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const inv = await find(ctx.organizationId, (await params).id);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const sent = await emailInvitation({
    organizationId: ctx.organizationId,
    email: inv.email,
    role: "member",
    language: inv.language,
    createdById: ctx.userId === "dev-user" ? null : ctx.userId,
    origin: linkOrigin(req.nextUrl.origin),
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error, code: sent.code }, { status: sent.status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const inv = await find(ctx.organizationId, (await params).id);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
