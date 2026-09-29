/**
 * The phone line: Twilio answers the salon's number and streams the call to
 * our voice server, where our own receptionist takes it.
 *
 *   caller -> Twilio number -> POST /api/twilio/voice (this CRM)
 *          <- TwiML: <Connect><Stream url="wss://.../voice/phone">
 *   Twilio <-> voice server, 8kHz mu-law audio both ways, as JSON frames
 *
 * The CRM decides which salon the call is for (from the number dialled) and
 * signs a short-lived pass saying so; Twilio hands the pass to the voice
 * server as a stream parameter, since a stream cannot carry headers.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { normalisePhone } from "@/lib/phone";

/**
 * Twilio's request signature: HMAC-SHA1, keyed with the account's auth token,
 * over the full URL Twilio called followed by every POST parameter, sorted by
 * name, each name then value. Base64. (Twilio's "Webhook security" docs.)
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  given: string | null
): boolean {
  if (!authToken || !given) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Hand the call's audio to the voice server, with the pass as a parameter. */
export function streamTwiml(streamUrl: string, parameters: Record<string, string>): string {
  const params = Object.entries(parameters)
    .map(([name, value]) => `<Parameter name="${xml(name)}" value="${xml(value)}"/>`)
    .join("");
  // When the voice server closes the stream the call moves past <Connect>;
  // with nothing after it, Twilio hangs up.
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(streamUrl)}">${params}</Stream></Connect></Response>`;
}

/** Said when the line cannot be answered by the receptionist at all. */
export function sayAndHangUpTwiml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Amy">${xml(text)}</Say><Hangup/></Response>`;
}

/**
 * The caller's number as the receptionist should see it: E.164, or null when
 * withheld. Twilio sends withheld calls as "anonymous", "Restricted" and the
 * like, which do not parse as numbers.
 */
export function callerFromTwilio(from: string | null | undefined): string | null {
  const parsed = normalisePhone(from ?? undefined);
  return parsed.ok ? parsed.e164 : null;
}

// --- Media stream frames ------------------------------------------------------------------

/** What Twilio sends over the stream, as far as the voice server cares. */
export type TwilioStreamEvent =
  | { event: "connected" }
  | { event: "start"; streamSid: string; callSid: string; customParameters: Record<string, string> }
  | { event: "media"; audio: Buffer }
  | { event: "stop" }
  | { event: "other" };

export function parseTwilioFrame(raw: string): TwilioStreamEvent | null {
  let msg: {
    event?: string;
    streamSid?: string;
    start?: { streamSid?: string; callSid?: string; customParameters?: Record<string, string> };
    media?: { payload?: string; track?: string };
  };
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  switch (msg.event) {
    case "connected":
      return { event: "connected" };
    case "start":
      return {
        event: "start",
        streamSid: msg.start?.streamSid ?? msg.streamSid ?? "",
        callSid: msg.start?.callSid ?? "",
        customParameters: msg.start?.customParameters ?? {},
      };
    case "media":
      // Only the caller's side; a stream set to both tracks would echo us.
      if (msg.media?.track && msg.media.track !== "inbound") return { event: "other" };
      return { event: "media", audio: Buffer.from(msg.media?.payload ?? "", "base64") };
    case "stop":
      return { event: "stop" };
    default:
      return { event: "other" };
  }
}

/**
 * Audio to the caller. Split into pieces of at most `maxBytes` (400ms at 8kHz
 * mu-law by default) so a long reply reaches Twilio as a steady stream rather
 * than one frame it has to buffer whole.
 */
export function mediaFrames(streamSid: string, audio: Buffer, maxBytes = 3200): string[] {
  const frames: string[] = [];
  for (let at = 0; at < audio.length; at += maxBytes) {
    frames.push(
      JSON.stringify({ event: "media", streamSid, media: { payload: audio.subarray(at, at + maxBytes).toString("base64") } })
    );
  }
  return frames;
}

/** Stop whatever is still queued to play: the caller has started talking. */
export function clearFrame(streamSid: string): string {
  return JSON.stringify({ event: "clear", streamSid });
}
