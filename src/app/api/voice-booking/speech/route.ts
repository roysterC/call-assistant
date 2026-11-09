/**
 * The assistant's reply, spoken in the salon's ElevenLabs voice: the same
 * voice, model and pace as the phone receptionist (ELEVENLABS_* in .env).
 *
 *   GET ?sessionId=…&id=…     the reply kept under that id, as MP3, streamed
 *
 * Fetched by the panel's audio player, which starts playing as the first
 * bytes arrive. Only a reply the assistant gave this person can be spoken,
 * and only once (keepSpeech): this is not a way to turn any text into
 * speech on our account. Anything that goes wrong is a plain error, and the
 * panel reads the reply in the device's own voice instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { findSession, takeSpeech } from "@/lib/voice-booking/assistant";
import { elevenLabsSettings, elevenLabsStream } from "@/lib/receptionist/voice/providers";
import { recordUsage } from "@/lib/usage/record";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No voice is set up." }, { status: 503 });

  const params = req.nextUrl.searchParams;
  const session = findSession(params.get("sessionId") ?? undefined, ctx.organizationId, ctx.userId);
  const text = session ? takeSpeech(session, params.get("id") ?? "") : null;
  if (!session || !text) return NextResponse.json({ error: "Nothing to say." }, { status: 404 });

  try {
    // 64kbps MP3: every browser plays it, and it is plenty for one voice.
    const res = await elevenLabsStream(apiKey, text, "mp3_44100_64", elevenLabsSettings(), req.signal);
    if (!res) return new NextResponse(null, { status: 499 });
    void recordUsage(ctx.organizationId, {
      source: "desk_voice",
      sessionKey: session.id,
      startedAt: new Date(),
      counts: { ttsCharacters: text.length },
    });
    return new NextResponse(res.body, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[VOICE BOOKING] speech failed:", err);
    return NextResponse.json({ error: "The voice is not working just now." }, { status: 502 });
  }
}
