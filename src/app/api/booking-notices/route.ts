/**
 * The signed-in person's booking notices (src/lib/booking-notices.ts).
 *
 *   GET                                        the pop-ups still open
 *   POST { action: "dismiss", id? }            close one, or all of them
 *   POST { action: "seen", appointmentId }     the booking was opened
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { dismissNotices, markBookingSeen, openNotices } from "@/lib/booking-notices";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  try {
    const [open, cfg] = await Promise.all([openNotices(ctx.userId, ctx.organizationId), getSalonConfig(ctx.organizationId)]);
    return NextResponse.json({ ...open, timeZone: cfg.timeZone });
  } catch (error) {
    console.error("[BOOKING NOTICES API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown; id?: unknown; appointmentId?: unknown };
  try {
    if (body.action === "dismiss") {
      await dismissNotices(ctx.userId, ctx.organizationId, typeof body.id === "string" ? body.id : undefined);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "seen" && typeof body.appointmentId === "string") {
      await markBookingSeen(ctx.userId, ctx.organizationId, body.appointmentId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Say what to do: dismiss, or seen with an appointmentId." }, { status: 400 });
  } catch (error) {
    console.error("[BOOKING NOTICES API] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
