/**
 * Limits on wrong passwords, so a login cannot be guessed at.
 *
 * Counted over a sliding window, three ways:
 * - per address *and* IP: the lock someone guessing from one place hits.
 *   Keyed on both so a stranger who knows an owner's email can only lock
 *   themselves out, never the owner signing in from the salon.
 * - per address, across every IP, with a much higher limit: the backstop
 *   against guessing spread over many machines.
 * - per IP, across every address: one place trying many logins.
 *
 * Without an IP (no proxy header) the address-and-IP lock falls back to the
 * address alone, as before.
 *
 * A correct password clears the address's counts. Kept in memory: production
 * is one process on one box, and a restart forgetting the counts costs an
 * attacker nothing they could not get by waiting out the window.
 *
 * The IP limit only applies when the proxy says who the client is. Without
 * that header every login would share one count, and thirty wrong guesses
 * from anyone would lock the whole CRM out.
 */

export const WINDOW_MS = 15 * 60 * 1000;
/** From one IP (or with no IP known), at one address. */
export const MAX_FAILURES_PER_EMAIL = 10;
/** At one address, from anywhere. */
export const MAX_FAILURES_PER_EMAIL_ANYWHERE = 100;
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

  private static here(email: string, ip: string | null): string {
    return `email:${email}|${ip ?? "?"}`;
  }

  /** Whether another attempt may be checked at all. */
  allowed(email: string, ip: string | null): boolean {
    if (this.recent(LoginThrottle.here(email, ip)).length >= MAX_FAILURES_PER_EMAIL) return false;
    if (this.recent(`email:${email}`).length >= MAX_FAILURES_PER_EMAIL_ANYWHERE) return false;
    if (ip && this.recent(`ip:${ip}`).length >= MAX_FAILURES_PER_IP) return false;
    return true;
  }

  fail(email: string, ip: string | null): void {
    const t = this.now();
    for (const key of [LoginThrottle.here(email, ip), `email:${email}`, ...(ip ? [`ip:${ip}`] : [])]) {
      this.failures.set(key, [...this.recent(key), t]);
    }
  }

  succeed(email: string, ip: string | null): void {
    this.failures.delete(LoginThrottle.here(email, ip));
    this.failures.delete(`email:${email}`);
  }
}

export { clientIp } from "@/lib/client-ip";

export const loginThrottle = new LoginThrottle();
