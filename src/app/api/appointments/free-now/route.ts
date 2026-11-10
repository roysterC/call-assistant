import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { whoIsFreeAt } from "@/lib/booking/who-is-free";

/**
 * Who is free now, and when everyone else is next (the Diary's "Who's free").
 * `?service=` narrows it to those who do it, with when each could start it.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const service = new URL(req.url).searchParams.get("service");
    const result = await whoIsFreeAt(ctx.organizationId, { service });
    if ("error" in result) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[FREE NOW] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
