import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing";
import { setCancelAtPeriodEnd, stripeConfigured } from "@/lib/stripe-billing";

/**
 * The owner cancels their plan ({ cancel: true }), or keeps it after all
 * ({ cancel: false }). A cancelled plan carries on to the end of the month
 * already paid for, then ends; the salon is then paused, its bookings and
 * website kept (src/lib/plan.ts).
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  if (!stripeConfigured()) return NextResponse.json({ error: "Card payments are not set up yet." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { cancel?: unknown } | null;
  if (typeof body?.cancel !== "boolean") return NextResponse.json({ error: "Say whether to cancel." }, { status: 400 });
  const r = await setCancelAtPeriodEnd(ctx.organizationId, body.cancel);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "No card on file." ? 409 : 502 });
  return NextResponse.json(await billingSummary(ctx.organizationId));
}
