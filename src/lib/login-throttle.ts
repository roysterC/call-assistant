/**
 * Limits on wrong passwords, so a login cannot be guessed at.
 *
 * Counted per email address and per client IP over a sliding window. A
 * correct password clears the address's count. Kept in memory: production is
 * one process on one box, and a restart forgetting the counts costs an
 * attacker nothing they could not get by waiting out the window.
 *
 * The IP limit only applies when the proxy says who the client is. Without
 * that header every login would share one count, and thirty wrong guesses
 * from anyone would lock the whole CRM out.
 */

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 10;
export const MAX_FAILURES_PER_IP = 30;

export class LoginThrottle {
  private failures = new Map<string, number[]>();

  constructor(private now: () => number = Date.now) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const kept = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  /** Whether another attempt may be checked at all. */
  allowed(email: string, ip: string | null): boolean {
    if (this.recent(`email:${email}`).length >= MAX_FAILURES_PER_EMAIL) return false;
    if (ip && this.recent(`ip:${ip}`).length >= MAX_FAILURES_PER_IP) return false;
    return true;
  }

  fail(email: string, ip: string | null): void {
    const t = this.now();
    for (const key of [`email:${email}`, ...(ip ? [`ip:${ip}`] : [])]) {
      this.failures.set(key, [...this.recent(key), t]);
    }
  }

  succeed(email: string): void {
    this.failures.delete(`email:${email}`);
  }
}

/**
 * The client's IP as nginx reports it. X-Real-IP if set; otherwise the last
 * X-Forwarded-For entry, the one nginx appended — earlier entries come from
 * the client and can say anything.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").pop()?.trim();
  return last || null;
}

export const loginThrottle = new LoginThrottle();
