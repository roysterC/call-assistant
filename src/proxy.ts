import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { devBypassEnabled } from "@/lib/dev-bypass";
import {
  bookingOrigin,
  isBookingHost,
  redirectToBookingHost,
  requestHostname,
  routeOnBookingHost,
} from "@/lib/booking-host";

/** NextAuth v5's session cookie: the __Secure- one over https. */
const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

/**
 * The proxy in front of every page and API route (Next 16's name for
 * middleware). It checks the session cookie is genuine and in
 * date — signed with AUTH_SECRET, not expired — and leaves who the user is
 * and what they may do to route handlers via requireTenant(), which reads
 * the database.
 *
 * Checking only that a cookie existed let an expired or foreign one through:
 * the page shell rendered and every API call behind it failed, so the CRM
 * looked empty and broken rather than asking the user to sign in.
 */
export async function proxy(req: NextRequest) {
  // Salons' pages on their own address (BOOKING_URL, src/lib/booking-host.ts):
  // first, so the CRM is never served there, bypass or not.
  const booking = bookingOrigin();
  if (booking) {
    const { pathname, search } = req.nextUrl;
    if (isBookingHost(requestHostname(req.headers, req.nextUrl.host), booking)) {
      const route = routeOnBookingHost(pathname, search, booking);
      if (route.kind === "rewrite") return NextResponse.rewrite(new URL(route.path + search, req.url));
      if (route.kind === "redirect") return NextResponse.redirect(route.location, 308);
      if (route.kind === "not_found") return new NextResponse("Not found", { status: 404 });
      return NextResponse.next();
    }
    // A salon page asked for on the app's address. Not for the app's own
    // in-page navigation (an RSC fetch), which cannot follow a redirect to
    // another address.
    if (!req.headers.get("rsc")) {
      const to = redirectToBookingHost(pathname, search, booking);
      if (to) return NextResponse.redirect(to, 308);
    }
  }

  // Dev-only bypass for local preview with no real session. Never in a
  // production build, whatever the environment says.
  if (devBypassEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // Public routes - no auth required
  const publicPrefixes = [
    "/api/website-chat",
    "/api/whatsapp",
    // Twilio's "a call comes in" webhook; it proves itself with a signature.
    "/api/twilio",
    "/api/meta",
    // The server's own timer, which has no session; each job checks
    // CRON_SECRET itself.
    "/api/cron",
    // The uptime monitor's checks.
    "/api/health",
    // Browser error reports on their way to Sentry, including the login
    // page's own (src/app/api/monitoring).
    "/api/monitoring",
    "/api/auth",
    // An owner's invite link and the call that makes their login: they have
    // no login yet (src/lib/invitations.ts).
    "/invite/",
    "/api/invite",
    // "Forgot password?" and confirming an email from its link: someone
    // who cannot sign in, or a phone that never has (src/lib/auth-tokens.ts).
    "/forgot-password",
    "/reset-password/",
    "/verify-email/",
    "/api/password-reset",
    "/api/verify-email",
    "/embed",
    // A salon's own website and online booking (src/lib/online-booking):
    // clients, never logged in. /embed above covers the booking flow shown
    // inside a salon's existing website.
    "/s/",
    "/api/book/",
    "/book.js",
    "/login",
    // The in-person lead funnel and where it sends; no login by design.
    "/meet",
    "/api/funnel",
    // The links in rebooking texts (src/lib/rebook.ts), opened by clients.
    "/r/",
    "/api/rebook/stop",
    "/robots.txt",
    "/widget.js",
    "/test-widget.html",
    "/favicon",
    // Phones fetch the manifest and icons without the session cookie, so
    // behind the login redirect they would get the login page instead and
    // the home-screen icon would never appear.
    "/manifest.webmanifest",
    // The service worker behind booking alerts (public/sw.js): fetched by
    // the browser itself, and holds nothing private.
    "/sw.js",
    "/icons/",
    "/apple-icon",
    // Legal pages must be publicly accessible so Meta (app review),
    // Google, and end users can reach them without credentials.
    "/privacy-policy",
    "/terms-of-service",
    "/data-deletion",
  ];
  // The root is only a redirect to /login, so it needs no session either.
  if (pathname === "/" || publicPrefixes.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (await hasValidSession(req)) {
    return NextResponse.next();
  }

  // An API call gets a 401 to act on (apiFetch sends the page to /login);
  // following a redirect would hand it the login page's HTML instead.
  const res = pathname.startsWith("/api/")
    ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    : NextResponse.redirect(loginUrl(req));
  // Drop a cookie that failed the check, so it is not sent again.
  for (const { name } of req.cookies.getAll()) {
    if (SESSION_COOKIES.some((c) => isSessionCookie(name, c))) res.cookies.delete(name);
  }
  return res;
}

function loginUrl(req: NextRequest): URL {
  const url = new URL("/login", req.nextUrl);
  url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  return url;
}

/** A large session is split into name.0, name.1, … */
function isSessionCookie(cookie: string, name: string): boolean {
  return cookie === name || cookie.startsWith(`${name}.`);
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return false;
  const present = req.cookies.getAll().map((c) => c.name);
  for (const name of SESSION_COOKIES) {
    if (!present.some((c) => isSessionCookie(c, name))) continue;
    // The cookie's name is also the salt it was encrypted with.
    const token = await getToken({
      req,
      secret,
      cookieName: name,
      salt: name,
      secureCookie: name.startsWith("__Secure-"),
    });
    if (token) return true;
  }
  return false;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:js|css|png|jpg|jpeg|svg|ico|html)$).*)",
  ],
};
