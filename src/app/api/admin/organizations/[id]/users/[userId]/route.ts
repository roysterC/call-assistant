/**
 * One login at a salon: change its role, give it a new password, or remove
 * it. Super-admins only — there is no email, so a forgotten password comes
 * to us and we set a new one here. See src/lib/admin-users.ts for the rules.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { hashPassword } from "@/lib/password";
import { USER_FIELDS, canRemove, planUserChange } from "@/lib/admin-users";

type Params = { params: Promise<{ id: string; userId: string }> };

/** The login, only if it belongs to this organisation. */
async function findInOrg(organizationId: string, userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, role: true },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id: organizationId, userId } = await params;
    const target = await findInOrg(organizationId, userId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) ?? {};
    const change = planUserChange(target, { role: body.role, password: body.password });
    if (!change.ok) return NextResponse.json({ error: change.error }, { status: change.status });

    const user = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(change.role ? { role: change.role } : {}),
        // A new password signs out every device signed in with the old one.
        ...(change.password
          ? { passwordHash: await hashPassword(change.password), sessionVersion: { increment: 1 } }
          : {}),
      },
      select: USER_FIELDS,
    });
    return NextResponse.json(user);
  } catch (error) {
    console.error("[ADMIN USER] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Remove the login. Its sessions stop on the next request, because every
 * request re-reads the user; the salon's bookings, clients and calls are not
 * tied to a login and are untouched.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id: organizationId, userId } = await params;
    const target = await findInOrg(organizationId, userId);
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canRemove(target)) {
      return NextResponse.json({ error: "A super-admin login can't be removed here." }, { status: 403 });
    }
    await prisma.user.delete({ where: { id: target.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ADMIN USER] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
