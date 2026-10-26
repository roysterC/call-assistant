/** A test alert to every device the signed-in person turned alerts on for. */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { pushPublicKey, pushToUsers } from "@/lib/push";

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  if (!pushPublicKey()) return NextResponse.json({ error: "Alerts are not set up on the server yet." }, { status: 503 });
  const result = await pushToUsers([ctx.userId], {
    title: "Booking alerts are on",
    body: "New bookings from the receptionist will show here.",
    url: "/calendar",
    tag: "test",
  });
  return NextResponse.json(result);
}
