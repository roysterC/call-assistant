/**
 * One stylist login: change what it may see, reset its password, remove it.
 * Owner only, like the list.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { hashPassword, temporaryPassword } from "@/lib/password";
import { LOGIN_FIELDS } from "@/lib/team-logins";

type Params = { params: Promise<{ id: string }> };

/** Only stylist logins in this salon: never an owner's, never another salon's. */
async function findLogin(id: string, organizationId: string) {
  return prisma.user.findFirst({
    where: { id, organizationId, role: "stylist" },
    select: { id: true },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    if (!(await findLogin(id, ctx.organizationId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = (await req.json().catch(() => ({}))) ?? {};

    const data: {
      diaryScope?: string;
      canSeeTakings?: boolean;
      passwordHash?: string;
      mustChangePassword?: boolean;
    } = {};
    if (body.diaryScope === "own" || body.diaryScope === "salon") data.diaryScope = body.diaryScope;
    if (typeof body.canSeeTakings === "boolean") data.canSeeTakings = body.canSeeTakings;

    let password: string | null = null;
    if (body.resetPassword === true) {
      password = temporaryPassword();
      data.passwordHash = await hashPassword(password);
      data.mustChangePassword = true;
    }

    const login = await prisma.user.update({ where: { id }, data, select: LOGIN_FIELDS });
    return NextResponse.json({ login, temporaryPassword: password });
  } catch (error) {
    console.error("[TEAM LOGINS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Remove the login. Its session stops working on the next request, because
 * every request re-reads the user; the stylist's bookings are untouched.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    if (!(await findLogin(id, ctx.organizationId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[TEAM LOGINS API] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
