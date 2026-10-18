/**
 * For the uptime monitor: 200 when the CRM, its database and (where there
 * is one) the voice server all answer, 503 otherwise. Public; says nothing
 * a stranger could use. Backups have their own check, /api/health/backups,
 * so a missed backup does not read as the site being down.
 */

import { NextResponse } from "next/server";
import { checkDatabase, checkVoice } from "@/lib/health";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit("health", clientIpFromHeaders(req.headers), { tokens: 20, refillPerSecond: 1 }).allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const [database, voice] = await Promise.all([checkDatabase(), checkVoice()]);
  const ok = database.ok && voice.ok;
  return NextResponse.json(
    { status: ok ? "ok" : "down", checks: { database, voice } },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
