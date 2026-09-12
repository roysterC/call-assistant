/**
 * Where to send someone after signing in, restricted to somewhere inside this
 * app.
 *
 * `callbackUrl` arrives from the query string and used to go straight into
 * router.push(). Next treats a different-origin URL as external and performs a
 * full browser navigation to it, so /login?callbackUrl=https://example.invalid
 * signed the user in and then delivered them somewhere else entirely — on the
 * one page where a convincing copy of the site is most valuable to whoever
 * sent the link. Sign in, get bounced to a replica, type the password again.
 *
 * Only a rooted relative path is allowed through. "//host" and "/\host" are
 * both excluded because browsers read either as protocol-relative and would
 * leave the origin; anything else falls back to the dashboard.
 *
 * Lives here rather than in the page so it can be tested on its own, which is
 * the only way to be sure about the backslash cases — they are easy to get
 * wrong and easy to mangle on the way into a test.
 */
export function safeCallbackUrl(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
