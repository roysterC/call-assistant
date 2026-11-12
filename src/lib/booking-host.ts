/**
 * The address salons' pages are given out on: book.getkikai.com/<slug>
 * rather than app.getkikai.com/s/<slug>.
 *
 * Set by BOOKING_URL on the server (e.g. https://book.getkikai.com), pointed
 * at the same app by DNS and nginx. Unset, nothing here does anything: the
 * pages stay at /s/<slug> on whatever address the app has.
 *
 * On the booking address only the public booking pages exist. The CRM, its
 * login and its API are not served there at all, so nothing private is ever
 * reachable on the name salons put on their flyers and Instagram bios.
 *
 * Plain code, no Next.js: src/proxy.ts applies it.
 */

/**
 * What the booking address serves as it is: folders, exact paths, and the
 * site's icons. Exact rather than prefixes, so a salon called "iconic-hair"
 * is a salon, not an icon.
 */
const PASS_DIRS = ["/_next/", "/api/book/", "/api/health/", "/embed/book/", "/api/website-chat/"];
const PASS_EXACT = [
  // The script that puts booking in a salon's own website.
  "/book.js",
  // The salon's chat on its page (siteChatSiteId): the widget, its page and
  // its API, all public, as on any website the chat is put on.
  "/widget.js",
  "/embed",
  "/robots.txt",
  // Browser error reports from the booking pages (instrumentation-client.ts).
  "/api/monitoring",
  "/api/health",
];
const ICON_FILE = /^\/(favicon|icon|apple-icon)[\w-]*\.(ico|png|svg|jpg)$/;

function passes(pathname: string): boolean {
  return PASS_EXACT.includes(pathname) || PASS_DIRS.some((d) => pathname.startsWith(d)) || ICON_FILE.test(pathname);
}

const SLUG = "[a-z0-9][a-z0-9-]{0,62}";
const SALON_PATH = new RegExp(`^/(${SLUG})(/book)?/?$`);
const OLD_SALON_PATH = new RegExp(`^/s/(${SLUG})(/book)?/?$`);

/** The booking address's origin, from BOOKING_URL, or null when not set up. */
export function bookingOrigin(raw: string | undefined = process.env.BOOKING_URL): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The hostname a request was made to, as nginx passed it on. */
export function requestHostname(headers: Headers, fallback: string): string {
  const raw = headers.get("x-forwarded-host")?.split(",")[0] || headers.get("host") || fallback;
  return raw.trim().toLowerCase().replace(/:\d+$/, "");
}

export function isBookingHost(hostname: string, origin: string | null): boolean {
  return origin !== null && new URL(origin).hostname === hostname;
}

/** A salon's pages: on the booking address when there is one. */
export function salonUrls(
  slug: string,
  opts: { origin: string | null; onBookingHost: boolean }
): { home: string; book: string; absoluteHome: string | null; absoluteBook: string | null } {
  const base = opts.onBookingHost ? `/${slug}` : `/s/${slug}`;
  return {
    home: base,
    book: `${base}/book`,
    absoluteHome: opts.origin ? `${opts.origin}/${slug}` : null,
    absoluteBook: opts.origin ? `${opts.origin}/${slug}/book` : null,
  };
}

export type HostRoute =
  | { kind: "pass" }
  | { kind: "rewrite"; path: string }
  | { kind: "redirect"; location: string }
  | { kind: "not_found" };

/**
 * What a request to the booking address gets: a salon's page (rewritten onto
 * /s/<slug>), something the pages need, a redirect, or nothing at all.
 */
export function routeOnBookingHost(pathname: string, search: string, origin: string): HostRoute {
  // The bare address: the company's own site, one level up
  // (book.getkikai.com -> getkikai.com).
  if (pathname === "/" || pathname === "") {
    const host = new URL(origin).hostname.split(".");
    const parent = host.length > 2 ? host.slice(1).join(".") : host.join(".");
    return { kind: "redirect", location: `${new URL(origin).protocol}//${parent}/` };
  }
  if (passes(pathname)) return { kind: "pass" };

  // An old /s/<slug> link: to the address it now has.
  const old = OLD_SALON_PATH.exec(pathname);
  if (old) return { kind: "redirect", location: `${origin}/${old[1]}${old[2] ?? ""}${search}` };

  const m = SALON_PATH.exec(pathname);
  if (m) return { kind: "rewrite", path: `/s/${m[1]}${m[2] ?? ""}` };

  return { kind: "not_found" };
}

/**
 * On the app's own address, a salon page asked for at /s/<slug> goes to the
 * booking address, so the links salons were given before keep working and
 * every page has one address. Null for anything else.
 */
export function redirectToBookingHost(pathname: string, search: string, origin: string): string | null {
  const m = OLD_SALON_PATH.exec(pathname);
  return m ? `${origin}/${m[1]}${m[2] ?? ""}${search}` : null;
}
