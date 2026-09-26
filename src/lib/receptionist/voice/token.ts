/**
 * Short-lived passes from the CRM to the voice server.
 *
 * The voice server is a separate process on a separate port, so it cannot read
 * the CRM's sign-in cookie. Instead the CRM, having checked who is asking,
 * signs a pass naming the salon and the person, and the browser presents it
 * when it opens the audio connection. The pass is only good for opening a
 * connection within a minute; the call itself can then run as long as it runs.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface VoicePass {
  organizationId: string;
  userId: string;
  /** Caller ID to pretend the call came from; null is withheld. */
  callerNumber: string | null;
  /** Expiry, in ms since the epoch. */
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

function mac(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signVoicePass(pass: VoicePass, secret: string): string {
  const body = b64(JSON.stringify(pass));
  return `${body}.${mac(body, secret)}`;
}

export function verifyVoicePass(token: string, secret: string, now = Date.now()): VoicePass | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !secret) return null;
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const pass = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as VoicePass;
    if (typeof pass.exp !== "number" || pass.exp < now) return null;
    if (typeof pass.organizationId !== "string" || typeof pass.userId !== "string") return null;
    return pass;
  } catch {
    return null;
  }
}
