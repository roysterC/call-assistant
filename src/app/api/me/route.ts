/**
 * Who is signed in and what they may do, for the screens to shape themselves
 * around. Advisory only: every API route enforces access itself, so a screen
 * that got this wrong would show an error, not someone else's data.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { isLang } from "@/lib/i18n";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  const user =
    ctx.userId === "dev-user"
      ? null
      : await prisma.user.findUnique({
          where: { id: ctx.userId },
          select: { name: true, email: true, language: true },
        });

  return NextResponse.json({
    role: ctx.role,
    name: user?.name ?? null,
    email: user?.email ?? null,
    language: user?.language ?? null,
  });
}

/** PUT { language }: the language this person reads the CRM in. */
export async function PUT(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as { language?: unknown };
  if (!isLang(body.language)) return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  // The local dev bypass has no user record to keep it on.
  if (ctx.userId !== "dev-user") {
    await prisma.user.update({ where: { id: ctx.userId }, data: { language: body.language } });
  }
  return NextResponse.json({ ok: true, language: body.language });
}
