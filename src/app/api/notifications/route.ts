/**
 * What is waiting on the signed-in person (src/lib/notifications.ts): new
 * bookings, callbacks and quotes, with their counts. Fetched every half
 * minute by the CRM, and at once on a push or a change made here.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { notificationsFor } from "@/lib/notifications";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  try {
    return NextResponse.json(await notificationsFor(ctx.userId, ctx.organizationId));
  } catch (error) {
    console.error("[NOTIFICATIONS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
