import { createHash, timingSafeEqual } from "crypto";

/**
 * Whether a request to /api/cron/* carries the server timer's CRON_SECRET
 * (scripts/send-reminders.sh). The routes are public in proxy.ts, since the
 * timer has no session, so each one checks this itself.
 */
export function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  // Hashed first so the comparison takes the same time whatever the lengths.
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
