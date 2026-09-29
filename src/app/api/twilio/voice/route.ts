/**
 * Twilio calls this when someone rings a salon's number: "a call comes in".
 *
 * Checks the request really is from Twilio, finds the salon from the number
 * dialled, and answers with TwiML that streams the call to our voice server,
 * where our own receptionist takes it. See src/lib/twilio-voice.ts.
 *
 * Set as the number's voice webhook in the Twilio console (HTTP POST):
 *   https://<crm host>/api/twilio/voice
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signVoicePass } from "@/lib/receptionist/voice/token";
import {
  callerFromTwilio,
  sayAndHangUpTwiml,
  streamTwiml,
  validTwilioSignature,
} from "@/lib/twilio-voice";
import { normalisePhone } from "@/lib/phone";

const twiml = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });

/**
 * The URL exactly as Twilio called it, which the signature covers. Behind the
 * web server the request arrives as plain http on localhost, so it is rebuilt
 * from the forwarded headers; TWILIO_VOICE_WEBHOOK_URL overrides that if the
 * proxy in front ever rewrites the host.
 */
function publicUrl(req: NextRequest): string {
  const fixed = process.env.TWILIO_VOICE_WEBHOOK_URL?.trim();
  if (fixed) return fixed;
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

const SORRY = "Sorry, we can't take your call right now. Please try again later. Goodbye.";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;

  // Anyone can post to a public URL; only Twilio can sign with our token.
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!validTwilioSignature(authToken, publicUrl(req), params, req.headers.get("x-twilio-signature"))) {
    console.warn(`[TWILIO] refused an unsigned or mis-signed voice webhook${authToken ? "" : " (TWILIO_AUTH_TOKEN is not set)"}`);
    return new Response("Forbidden", { status: 403 });
  }

  const dialled = normalisePhone(params.To);
  const line = dialled.ok
    ? await prisma.phoneNumber.findFirst({
        where: { number: dialled.e164, channel: "vapi", active: true },
        select: { organizationId: true, organization: { select: { settings: { select: { voiceEnabled: true } } } } },
      })
    : null;
  if (!line) {
    console.warn(`[TWILIO] a call to ${params.To ?? "?"} matched no salon's voice number`);
    return twiml(sayAndHangUpTwiml(SORRY));
  }
  if (!line.organization.settings?.voiceEnabled) {
    console.warn(`[TWILIO] a call to ${params.To} reached a salon without voice switched on`);
    return twiml(sayAndHangUpTwiml(SORRY));
  }

  const base = process.env.RECEPTIONIST_VOICE_URL?.replace(/\/+$/, "");
  const secret = process.env.RECEPTIONIST_VOICE_SECRET;
  if (!base || !secret) {
    console.error("[TWILIO] RECEPTIONIST_VOICE_URL or RECEPTIONIST_VOICE_SECRET is not set; cannot answer calls");
    return twiml(sayAndHangUpTwiml(SORRY));
  }

  // Good for opening the stream within a minute; the call then runs as long
  // as it runs.
  const token = signVoicePass(
    {
      organizationId: line.organizationId,
      userId: "phone",
      callerNumber: callerFromTwilio(params.From),
      purpose: "phone",
      callSid: params.CallSid,
      exp: Date.now() + 60_000,
    },
    secret
  );
  return twiml(streamTwiml(`${base}/phone`, { token }));
}
