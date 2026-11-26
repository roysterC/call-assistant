/**
 * The addresses salons' pages are given out on: their own,
 * <slug>.getkikai.com (SALON_DOMAIN, below), or book.getkikai.com/<slug>,
 * rather than app.getkikai.com/s/<slug>. With both set, book.getkikai.com
 * keeps serving the booking script and embeds, and sends a salon's page on
 * to the salon's own address.
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

/**
 * The domain salons get an address of their own under: <slug>.<SALON_DOMAIN>
 * (production: getkikai.com, so a salon is at maison-nails.getkikai.com).
 * Null when not set up, and then salons stay on BOOKING_URL or /s/<slug>.
 *
 * Needs a wildcard DNS record (*.getkikai.com) to this box and Caddy issuing
 * each salon's certificate on demand, asking /api/salon-tls first: README,
 * "Salons' pages".
 */
export function salonDomain(raw: string | undefined = process.env.SALON_DOMAIN): string | null {
  const v = raw?.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  return v && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : null;
}

/**
 * Names under the salon domain that are never a salon's: our own addresses,
 * and ones a mail server, a status page or the marketing site may want. A
 * salon given one of these keeps its page on the booking address instead.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "www", "app", "book", "api", "admin", "dashboard", "login", "auth", "account", "billing",
  "mail", "email", "webmail", "smtp", "imap", "pop", "mx", "autodiscover", "autoconfig",
  "ns1", "ns2", "dns", "cdn", "static", "assets", "media", "img", "files",
  "status", "help", "support", "docs", "blog", "news", "shop", "store",
  "staging", "dev", "test", "demo", "beta", "preview", "m", "go", "link", "links",
];

/** Whether a salon with this slug can have <slug>.<domain>: a usable DNS label, not one of ours. */
export function hasOwnSubdomain(slug: string): boolean {
  return new RegExp(`^${SLUG}$`).test(slug) && !slug.endsWith("-") && !RESERVED_SUBDOMAINS.includes(slug);
}

/** The salon whose own address `hostname` is, or null. */
export function salonFromHost(hostname: string, domain: string | null): string | null {
  if (!domain) return null;
  const suffix = `.${domain}`;
  if (!hostname.endsWith(suffix)) return null;
  const label = hostname.slice(0, -suffix.length);
  return hasOwnSubdomain(label) ? label : null;
}

/** A salon's own address, https://<slug>.<domain>, or null when it has none. */
export function salonOrigin(slug: string, domain: string | null): string | null {
  return domain && hasOwnSubdomain(slug) ? `https://${slug}.${domain}` : null;
}

export function isBookingHost(hostname: string, origin: string | null): boolean {
  return origin !== null && new URL(origin).hostname === hostname;
}

/**
 * A salon's pages: on its own address when it has one, else on the booking
 * address when there is one, else /s/<slug> on the app. Paths are for links
 * on the address the request came in on; the absolute ones are where the
 * pages are given out.
 */
export function salonUrls(
  slug: string,
  opts: { origin: string | null; onBookingHost: boolean; domain?: string | null; onSalonHost?: boolean }
): { home: string; book: string; absoluteHome: string | null; absoluteBook: string | null } {
  const own = salonOrigin(slug, opts.domain ?? null);
  const base = opts.onSalonHost ? "" : opts.onBookingHost ? `/${slug}` : `/s/${slug}`;
  const absolute = own ?? (opts.origin ? `${opts.origin}/${slug}` : null);
  return {
    home: base || "/",
    book: `${base}/book`,
    absoluteHome: own ? `${own}/` : absolute,
    absoluteBook: absolute ? `${absolute}/book` : null,
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
export function routeOnBookingHost(
  pathname: string,
  search: string,
  origin: string,
  domain: string | null = null
): HostRoute {
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
  if (old) {
    const own = salonOrigin(old[1], domain);
    return { kind: "redirect", location: own ? `${own}${old[2] ?? "/"}${search}` : `${origin}/${old[1]}${old[2] ?? ""}${search}` };
  }

  const m = SALON_PATH.exec(pathname);
  if (m) {
    // A salon with an address of its own: there, so flyers and Instagram
    // bios printed with book.getkikai.com/<slug> keep working.
    const own = salonOrigin(m[1], domain);
    if (own) return { kind: "redirect", location: `${own}${m[2] ?? "/"}${search}` };
    return { kind: "rewrite", path: `/s/${m[1]}${m[2] ?? ""}` };
  }

  return { kind: "not_found" };
}

/**
 * On the app's own address, a salon page asked for at /s/<slug> goes to the
 * booking address, so the links salons were given before keep working and
 * every page has one address. Null for anything else.
 */
export function redirectToBookingHost(
  pathname: string,
  search: string,
  origin: string | null,
  domain: string | null = null
): string | null {
  const m = OLD_SALON_PATH.exec(pathname);
  if (!m) return null;
  const own = salonOrigin(m[1], domain);
  if (own) return `${own}${m[2] ?? "/"}${search}`;
  return origin ? `${origin}/${m[1]}${m[2] ?? ""}${search}` : null;
}

/**
 * What a request to a salon's own address (<slug>.getkikai.com) gets: its
 * page at /, its booking flow at /book, what the pages need, or nothing.
 */
export function routeOnSalonHost(pathname: string, search: string, slug: string, domain: string): HostRoute {
  if (pathname === "/" || pathname === "") return { kind: "rewrite", path: `/s/${slug}` };
  if (pathname === "/book" || pathname === "/book/") return { kind: "rewrite", path: `/s/${slug}/book` };
  if (passes(pathname)) return { kind: "pass" };
  // Its own old /s/<slug> path, typed onto the new address.
  const old = OLD_SALON_PATH.exec(pathname);
  if (old && old[1] === slug) return { kind: "redirect", location: `https://${slug}.${domain}${old[2] ?? "/"}${search}` };
  return { kind: "not_found" };
}

/**
 * Whether `hostname` serves only salons' public pages (the booking address,
 * or a salon's own), so the CRM's chrome, session and crawl rules stay off it.
 */
export function servesOnlySalonPages(
  hostname: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  return isBookingHost(hostname, bookingOrigin(env.BOOKING_URL)) || salonFromHost(hostname, salonDomain(env.SALON_DOMAIN)) !== null;
}
