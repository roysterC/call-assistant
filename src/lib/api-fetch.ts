/**
 * Wrapper around fetch() that auto-propagates the ?asOrg query param
 * so that super-admins viewing a different org (via the sidebar switcher)
 * scope every dashboard API call to that org instead of their own.
 *
 * Only modifies internal same-origin "/api/..." paths in the browser. SSR,
 * external URLs, and non-/api paths pass through unchanged.
 *
 * A 401 means the session is gone — expired, signed out elsewhere, the
 * password changed, the login removed — so the page goes to /login and comes
 * back here afterwards, instead of sitting there with every panel failing.
 */
export function apiFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  if (typeof window === "undefined" || !input.startsWith("/api/")) {
    return fetch(input, init);
  }
  return fetch(withAsOrg(input), init).then((res) => {
    if (res.status === 401) toLogin();
    return res;
  });
}

function withAsOrg(input: string): string {
  const asOrg = new URLSearchParams(window.location.search).get("asOrg");
  if (!asOrg) return input;

  // Don't double-append if the caller already set it
  if (/[?&]asOrg=/.test(input)) return input;

  const sep = input.includes("?") ? "&" : "?";
  return `${input}${sep}asOrg=${encodeURIComponent(asOrg)}`;
}

let leaving = false;

function toLogin() {
  const { pathname, search } = window.location;
  if (leaving || pathname.startsWith("/login")) return;
  leaving = true;
  const back = encodeURIComponent(pathname + search);
  window.location.href = `/login?callbackUrl=${back}&error=SessionRequired`;
}
