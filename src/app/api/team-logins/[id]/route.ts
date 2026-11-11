import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

/**
 * Remove a member of staff's login, for the salon's owner. Staff only, in
 * this salon, and never the owner themselves: an owner is removed by Kikai.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const target = await prisma.user.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role !== "member" || target.id === ctx.userId) {
    return NextResponse.json({ error: "Only a member of staff's login can be removed here." }, { status: 403 });
  }
  await prisma.user.delete({ where: { id: target.id } });
  return NextResponse.json({ ok: true });
}
