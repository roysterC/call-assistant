import { createHmac, createHash, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET;

// Surface misconfiguration at boot instead of silently accepting unsigned
// requests in production. In dev we log a warning but still allow them so the
// Vapi dashboard's "test webhook" button keeps working.
if (!WEBHOOK_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[VAPI] VAPI_WEBHOOK_SECRET is not set — ALL incoming Vapi requests will be rejected as unsigned."
    );
  } else {
    console.warn(
      "[VAPI] VAPI_WEBHOOK_SECRET not set — dev-only bypass active. Unsigned Vapi requests will be accepted."
    );
  }
}

/**
 * Compare two strings without leaking length or content through timing.
 *
 * `timingSafeEqual` throws on unequal lengths, which would itself be a length
 * oracle, so both sides are hashed to a fixed 32 bytes first.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify an inbound Vapi request.
 *
 * Vapi has shipped two different schemes for `serverUrlSecret` and we cannot
 * tell from the dashboard which one a given assistant uses:
 *
 *   1. **Shared secret** — the literal secret string is sent in the header.
 *   2. **HMAC** — the header carries `HMAC-SHA256(rawBody, secret)` as hex.
 *
 * Accepting both removes the guesswork. A plain secret can never collide with
 * a hex digest of the body, so supporting both costs no security: an attacker
 * still needs the secret either way.
 *
 * Header name also varies (`x-vapi-signature` vs `x-vapi-secret`), so callers
 * should pass whichever is present.
 *
 * @param payload   The RAW request body, exactly as received. Re-serialising a
 *                  parsed object changes the bytes and breaks the HMAC.
 * @param signature Header value, or null when absent.
 */
export function verifyVapiSignature(
  payload: string,
  signature: string | null
): boolean {
  // Production: a missing secret means we CANNOT verify anything — reject.
  // Dev: allow so local testing keeps working.
  if (!WEBHOOK_SECRET) {
    return process.env.NODE_ENV !== "production";
  }
  if (!signature) return false;

  // Scheme 1: plain shared secret.
  if (safeEqual(signature, WEBHOOK_SECRET)) return true;

  // Scheme 2: HMAC-SHA256 of the raw body, hex-encoded.
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  return safeEqual(signature, expected);
}

/**
 * Pull the signature from whichever header Vapi used.
 */
export function vapiSignatureFromHeaders(headers: Headers): string | null {
  return (
    headers.get("x-vapi-signature") ||
    headers.get("x-vapi-secret") ||
    null
  );
}
