/**
 * Who a request came from, as the web server in front of the app says.
 *
 * Production is behind Caddy, which replaces X-Forwarded-For with the
 * address it saw (it trusts no proxy before it), and passes X-Real-IP
 * through as the client sent it. nginx, if it ever comes back, appends to
 * X-Forwarded-For. So the last X-Forwarded-For entry is the one the proxy
 * wrote, either way; anything before it, and X-Real-IP behind Caddy, can say
 * whatever the client likes. X-Real-IP is only read when there is no
 * X-Forwarded-For at all.
 *
 * Shared by the login throttle and every rate limit, so they cannot disagree
 * about who someone is.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").pop()?.trim();
  if (last) return last;
  return headers.get("x-real-ip")?.trim() || null;
}
