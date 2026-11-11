import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/** The invite page's calls, limited by address: a refusal to send back, or null to go on. */
export function inviteRateLimited(req: NextRequest): NextResponse | null {
  const { allowed, retryAfterMs } = rateLimit("invite", clientIpFromHeaders(req.headers), {
    tokens: 10,
    refillPerSecond: 1 / 30,
  });
  if (allowed) return null;
  return NextResponse.json(
    { error: "Too many tries. Wait a minute and try again.", code: "tooMany" },
    { status: 429, headers: { "Retry-After": String(Math.ceil((retryAfterMs ?? 60_000) / 1000)) } }
  );
}

