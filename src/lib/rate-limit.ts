/**
 * In-memory token-bucket rate limiter with periodic cleanup.
 *
 * Buckets are keyed by an arbitrary string (session id, IP, phone number,
 * etc.). Each key gets its own bucket; exhausting it returns `allowed:false`
 * with a hint of how long until the next token refills.
 *
 * Per-process only — if you run multiple Node instances behind a load
 * balancer the limits will be per-instance. Good enough to stop a single
 * spammer; not a substitute for a distributed limiter (Redis, Upstash) if
 * this app ever scales horizontally.
 *
 * The previous implementation (`src/app/api/website-chat/message/route.ts`)
 * never evicted buckets — each new sessionId leaked a Map entry forever.
 * This module sweeps every 5 minutes and drops any bucket not touched in
 * the last 15 minutes.
 */

import { clientIp } from "@/lib/client-ip";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface RateLimitOptions {
  /** Max tokens in the bucket (burst size). Default 10. */
  tokens?: number;
  /** Tokens added per second as the bucket refills. Default 1. */
  refillPerSecond?: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  lastTouched: number;
}

// Single global Map keyed by namespace+key so different endpoints don't
// stomp each other's buckets.
const buckets = new Map<string, Bucket>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BUCKET_TTL_MS = 15 * 60 * 1000; // 15 minutes idle → evict

// Guarded so tests / hot-reload don't set multiple intervals.
let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweep(): void {
  if (sweepTimer !== null) return;
  sweepTimer = setInterval(() => {
    const cutoff = Date.now() - BUCKET_TTL_MS;
    for (const [key, bucket] of buckets) {
      if (bucket.lastTouched < cutoff) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't block the Node event loop from exiting (tests, graceful shutdown).
  sweepTimer.unref?.();
}

/**
 * Take one token from the bucket identified by `namespace:key`.
 * `namespace` is just a string prefix to isolate limiter scopes — e.g.
 * "whatsapp-webhook" vs "website-chat".
 */
export function rateLimit(
  namespace: string,
  key: string,
  options: RateLimitOptions = {}
): RateLimitResult {
  ensureSweep();

  const tokens = options.tokens ?? 10;
  const refillPerSecond = options.refillPerSecond ?? 1;
  const compositeKey = `${namespace}:${key}`;
  const now = Date.now();

  const bucket = buckets.get(compositeKey) || {
    tokens,
    lastRefill: now,
    lastTouched: now,
  };

  // Refill
  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(
    tokens,
    bucket.tokens + elapsedSeconds * refillPerSecond
  );
  bucket.lastRefill = now;
  bucket.lastTouched = now;

  if (bucket.tokens < 1) {
    buckets.set(compositeKey, bucket);
    // Time until we have 1 token: (1 - current) / refillPerSecond seconds
    const retryAfterMs = Math.ceil(
      ((1 - bucket.tokens) / refillPerSecond) * 1000
    );
    return { allowed: false, retryAfterMs };
  }

  bucket.tokens -= 1;
  buckets.set(compositeKey, bucket);
  return { allowed: true };
}

/**
 * The client's address for rate-limit keys (see client-ip.ts). Requests the
 * proxy says nothing about share one "unknown" key.
 */
export function clientIpFromHeaders(headers: Headers): string {
  return clientIp(headers) ?? "unknown";
}

// Test-only escape hatch; not exported from the public barrel (src/lib).
export function __resetRateLimitForTests(): void {
  buckets.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
