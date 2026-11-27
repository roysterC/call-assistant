import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { billingSummary } from "@/lib/billing";
import { stripeConfigured } from "@/lib/stripe-billing";

/** The salon's plan and bill, for Settings → Plan & billing. The owner's only. */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const summary = await billingSummary(ctx.organizationId);
  if (!summary) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...summary, cardPayments: stripeConfigured() });
}
