import { createHmac, createHash, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET;

/**
 * How long a signed request stays valid, when Vapi includes a timestamp.
 *
 * Signing `{timestamp}.{body}` is only worth anything if the timestamp is
 * actually checked — otherwise a captured request replays forever. Five
 * minutes is generous for clock skew between Vapi and the VPS while keeping
 * the replay window short.
 */
const MAX_SKEW_MS = 5 * 60 * 1000;

// Vapi's HMAC credential lets you name the headers. These are its defaults;
// the older `x-vapi-*` names are kept so an assistant still on the legacy
// shared-secret scheme does not break mid-deploy.
const SIGNATURE_HEADERS = [
  "x-signature",
  "x-vapi-signature",
  "x-vapi-secret",
] as const;

const TIMESTAMP_HEADER = "x-timestamp";

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
 * Compare without leaking length or content through timing.
 *
 * `timingSafeEqual` throws on unequal lengths, which would itself be a length
 * oracle, so both sides are hashed to a fixed 32 bytes first.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Strip a `sha256=` style prefix if the credential is configured with one. */
function stripPrefix(signature: string): string {
  const eq = signature.indexOf("=");
  if (eq > 0 && eq < 16) return signature.slice(eq + 1);
  return signature;
}

/**
 * Vapi's timestamp is epoch — seconds or milliseconds depending on version.
 * Anything past ~2001 in ms is > 1e12, which separates the two cleanly.
 */
function parseTimestamp(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

export interface VerificationResult {
  ok: boolean;
  /** Why it failed, for logging. Never includes the secret. */
  reason?: string;
}

/**
 * Verify an inbound Vapi request.
 *
 * Vapi's HMAC credential signs `{timestamp}.{body}` by default and sends the
 * hex digest in `x-signature`, with the timestamp in `x-timestamp`. Older
 * assistants instead send the raw shared secret in `x-vapi-secret`, and some
 * send an HMAC of the body alone. All three are accepted: a plain secret can
 * never collide with a hex digest, so supporting them together costs nothing
 * — an attacker still needs the secret in every case.
 *
 * @param payload The RAW request body, exactly as received. Re-serialising a
 *                parsed object changes the bytes and breaks the HMAC.
 */
export function verifyVapiRequest(
  payload: string,
  headers: Headers
): VerificationResult {
  // Production: no secret means we cannot verify anything — reject.
  // Dev: allow, so local testing works without one.
  if (!WEBHOOK_SECRET) {
    return process.env.NODE_ENV !== "production"
      ? { ok: true }
      : { ok: false, reason: "no VAPI_WEBHOOK_SECRET configured" };
  }

  let signature: string | null = null;
  let usedHeader = "";
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (value) {
      signature = stripPrefix(value.trim());
      usedHeader = name;
      break;
    }
  }
  if (!signature) {
    return { ok: false, reason: "no signature header present" };
  }

  const rawTimestamp = headers.get(TIMESTAMP_HEADER);

  // Timestamped payload — Vapi's default, and the only variant with replay
  // protection. Check freshness BEFORE the digest so a stale-but-valid
  // signature is still rejected.
  if (rawTimestamp) {
    const ts = parseTimestamp(rawTimestamp);
    if (ts === null) {
      return { ok: false, reason: `unparseable ${TIMESTAMP_HEADER}` };
    }
    const skew = Math.abs(Date.now() - ts);
    if (skew > MAX_SKEW_MS) {
      return {
        ok: false,
        reason: `timestamp outside ${MAX_SKEW_MS / 1000}s window (skew ${Math.round(skew / 1000)}s)`,
      };
    }
    if (safeEqual(signature, hmacHex(WEBHOOK_SECRET, `${rawTimestamp}.${payload}`))) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `HMAC of {timestamp}.{body} did not match (header ${usedHeader})`,
    };
  }

  // No timestamp: HMAC of the body alone, or the legacy plain shared secret.
  if (safeEqual(signature, hmacHex(WEBHOOK_SECRET, payload))) return { ok: true };
  if (safeEqual(signature, WEBHOOK_SECRET)) return { ok: true };

  return {
    ok: false,
    reason: `no scheme matched (header ${usedHeader}, no ${TIMESTAMP_HEADER})`,
  };
}

/**
 * Header names present on a rejected request, for diagnostics.
 *
 * Names and lengths only — never values, which would put a valid signature
 * into the logs.
 */
export function describeAuthHeaders(headers: Headers): string {
  const seen: string[] = [];
  headers.forEach((value, name) => {
    const n = name.toLowerCase();
    if (
      n.includes("signature") ||
      n.includes("timestamp") ||
      n.includes("vapi") ||
      n === "authorization"
    ) {
      seen.push(`${n}(len=${value.length})`);
    }
  });
  return seen.length ? seen.join(", ") : "none";
}
