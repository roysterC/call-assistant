import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { replayEvent } from "@/lib/stripe-events";
import { stripeConfigured } from "@/lib/stripe-billing";

/** Act on a Stripe notice again (src/lib/stripe-events.ts): one that failed, once its cause is fixed. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;
  if (!stripeConfigured()) return NextResponse.json({ error: "Stripe is not set up." }, { status: 503 });
  const { id } = await params;
  const r = await replayEvent(id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json(r);
}
