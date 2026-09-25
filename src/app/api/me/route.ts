/**
 * Who is signed in and what they may do, for the screens to shape themselves
 * around. Advisory only: every API route enforces access itself, so a screen
 * that got this wrong would show an error, not someone else's data.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { stylists: true, beforePasswordChange: true });
  if (isErrorResponse(ctx)) return ctx;

  const user =
    ctx.userId === "dev-user"
      ? null
      : await prisma.user.findUnique({
          where: { id: ctx.userId },
          select: { name: true, email: true, mustChangePassword: true },
        });

  return NextResponse.json({
    role: ctx.role,
    name: user?.name ?? null,
    email: user?.email ?? null,
    stylist: ctx.stylist,
    mustChangePassword: ctx.stylist !== null && Boolean(user?.mustChangePassword),
  });
}
