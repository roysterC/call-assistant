import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { loadPlan } from "@/lib/plan-access";

/**
 * Where the plan stands (src/lib/plan.ts), and nothing else: for the banner
 * on every page. Staff too, so they know why booking is refused; what the
 * salon pays stays with the owner (/api/billing).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const plan = await loadPlan(ctx.organizationId);
  return NextResponse.json({
    plan: plan && { status: plan.status, access: plan.access, warning: plan.warning, trialDaysLeft: plan.trialDaysLeft },
  });
}
