import { NextRequest, NextResponse } from "next/server";
import { verifyEmail } from "@/lib/auth-tokens";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * Confirming an address from the emailed link. No login needed (src/proxy.ts):
 * the link may be opened on a phone that has never signed in. A POST from
 * the page, not the GET of opening the link, so a mail scanner that follows
 * links cannot confirm it for them.
 */
export async function POST(req: NextRequest) {
  const { allowed } = rateLimit("verify-email", clientIpFromHeaders(req.headers), { tokens: 10, refillPerSecond: 1 / 30 });
  if (!allowed) return NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const result = await verifyEmail(body?.token);
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json({ email: result.email });
}
