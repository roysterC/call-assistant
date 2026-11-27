/**
 * A pass for dictating to the diary: the voice server turns speech into
 * words, and the words come back to the browser, which sends them to
 * /api/voice-booking.
 *
 * Anyone who can book at the desk, on a plan with an AI add-on. The pass opens
 * dictation only, never a lab call, and only within a minute of being issued.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { signVoicePass } from "@/lib/receptionist/voice/token";
import { assistantVoiceAllowed, VOICE_UPGRADE } from "@/lib/plan-access";

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  // Speech to text comes with the AI add-ons (src/lib/plan.ts).
  if (!(await assistantVoiceAllowed(ctx.organizationId, ctx))) return NextResponse.json(VOICE_UPGRADE, { status: 402 });

  const base = process.env.RECEPTIONIST_VOICE_URL?.replace(/\/+$/, "");
  const secret = process.env.RECEPTIONIST_VOICE_SECRET;
  if (!base || !secret) {
    return NextResponse.json(
      { error: "Voice isn't set up here yet. Type the booking instead, or ask Kikai to switch it on." },
      { status: 503 }
    );
  }

  const token = signVoicePass(
    { organizationId: ctx.organizationId, userId: ctx.userId, callerNumber: null, purpose: "dictate", exp: Date.now() + 60_000 },
    secret
  );
  return NextResponse.json({ url: `${base}/dictate?token=${encodeURIComponent(token)}` });
}
