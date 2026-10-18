/**
 * For a second uptime monitor: 200 when last night's database backup reached
 * off-site storage, 503 when it is more than a day old or never ran. Public,
 * like /api/health, and says only how old it is.
 */

import { NextResponse } from "next/server";
import { checkBackup } from "@/lib/health";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit("health", clientIpFromHeaders(req.headers), { tokens: 20, refillPerSecond: 1 }).allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const backup = await checkBackup();
  return NextResponse.json(
    { status: backup.ok ? "ok" : "stale", backup },
    { status: backup.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
