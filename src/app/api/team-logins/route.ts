/**
 * The owner's list of stylist logins: who has one, what each may see, and
 * adding one.
 *
 * Owner only. `requireTenant` shuts stylist logins out of this route by
 * default, which is the point: a stylist must not be able to raise their own
 * permissions or read a colleague's.
 *
 * There is no email sending, so a new login gets a temporary password that is
 * returned once for the owner to pass on. The stylist has to choose their own
 * before they can use anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { matchStylist } from "@/lib/salon-config";
import { hashPassword, temporaryPassword } from "@/lib/password";
import { LOGIN_FIELDS } from "@/lib/team-logins";


export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  const logins = await prisma.user.findMany({
    where: { organizationId: ctx.organizationId, role: "stylist" },
    select: LOGIN_FIELDS,
    orderBy: { stylistName: "asc" },
  });
  return NextResponse.json({ logins });
}

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = (await req.json().catch(() => ({}))) ?? {};
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
    }

    const cfg = await getSalonConfig(ctx.organizationId);
    const stylist = matchStylist(String(body.stylistName ?? ""), cfg.stylists);
    if (!stylist) {
      return NextResponse.json({ error: "Choose a stylist from the team." }, { status: 400 });
    }

    const taken = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { organizationId: ctx.organizationId, role: "stylist", stylistName: stylist.name },
        ],
      },
      select: { email: true },
    });
    if (taken) {
      return NextResponse.json(
        {
          error:
            taken.email === email
              ? "That email already has a login."
              : `${stylist.name} already has a login.`,
        },
        { status: 409 }
      );
    }

    const password = temporaryPassword();
    const login = await prisma.user.create({
      data: {
        email,
        name: String(body.name ?? "").trim() || stylist.name,
        role: "stylist",
        organizationId: ctx.organizationId,
        stylistName: stylist.name,
        diaryScope: body.diaryScope === "own" ? "own" : "salon",
        canSeeTakings: body.canSeeTakings !== false,
        mustChangePassword: true,
        passwordHash: await hashPassword(password),
      },
      select: LOGIN_FIELDS,
    });

    return NextResponse.json({ login, temporaryPassword: password }, { status: 201 });
  } catch (error) {
    console.error("[TEAM LOGINS API] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
