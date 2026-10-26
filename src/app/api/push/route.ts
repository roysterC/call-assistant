/**
 * This device's booking alerts (src/lib/push.ts).
 *
 *   GET                           the key to subscribe with, null if push is not set up
 *   POST { subscription }         this device wants alerts, for whoever is signed in
 *   DELETE { endpoint }           it no longer does
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { pushPublicKey } from "@/lib/push";

/** Push services' addresses are https and short; anything else is not one. */
function validEndpoint(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 1000) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

const key = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200;

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  return NextResponse.json({ publicKey: pushPublicKey() });
}

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as {
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  };
  const sub = body.subscription;
  if (!sub || !validEndpoint(sub.endpoint) || !key(sub.keys?.p256dh) || !key(sub.keys?.auth)) {
    return NextResponse.json({ error: "That is not a push subscription." }, { status: 400 });
  }
  try {
    const data = { userId: ctx.userId, p256dh: sub.keys!.p256dh as string, auth: sub.keys!.auth as string };
    // One device, one person: whoever signed in on it last.
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, ...data },
      update: data,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PUSH API] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as { endpoint?: unknown };
  if (!validEndpoint(body.endpoint)) return NextResponse.json({ error: "Which device?" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: ctx.userId } });
  return NextResponse.json({ ok: true });
}
