/**
 * A pass for opening a spoken lab call on the voice server.
 *
 * Same people as the typed lab: the salon's owner and super-admins. The voice
 * server cannot see the CRM's sign-in, so it trusts this signed pass instead;
 * the pass only opens a connection, and only within a minute of being issued.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { normalisePhone } from "@/lib/phone";
import { signVoicePass, voiceLabUrl } from "@/lib/receptionist/voice/token";

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  if (!ctx.isSuperAdmin && ctx.role !== "admin" && ctx.role !== "superAdmin") {
    return NextResponse.json({ error: "Only the salon's owner can use the lab." }, { status: 403 });
  }

  const labUrl = voiceLabUrl(process.env.RECEPTIONIST_VOICE_URL);
  const secret = process.env.RECEPTIONIST_VOICE_SECRET;
  if (!labUrl || !secret) {
    return NextResponse.json(
      {
        error:
          "The voice server isn't set up here: RECEPTIONIST_VOICE_URL and RECEPTIONIST_VOICE_SECRET need setting.",
      },
      { status: 503 }
    );
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as { callerNumber?: unknown };
  let callerNumber: string | null = null;
  if (typeof body.callerNumber === "string" && body.callerNumber.trim()) {
    const parsed = normalisePhone(body.callerNumber);
    if (!parsed.ok) {
      return NextResponse.json({ error: `That caller number won't work: ${parsed.reason}` }, { status: 400 });
    }
    callerNumber = parsed.e164;
  }

  const token = signVoicePass(
    { organizationId: ctx.organizationId, userId: ctx.userId, callerNumber, exp: Date.now() + 60_000 },
    secret
  );
  return NextResponse.json({ url: `${labUrl}?token=${encodeURIComponent(token)}`, callerNumber });
}
