import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { devBypassEnabled } from "@/lib/dev-bypass";

/** NextAuth v5's session cookie: the __Secure- one over https. */
const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"] as const;

/**
 * Edge-runtime middleware.
 *
 * Cannot import the full NextAuth config here because the Prisma adapter
 * uses Node-only modules. It checks the session cookie is genuine and in
 * date — signed with AUTH_SECRET, not expired — and leaves who the user is
 * and what they may do to route handlers via requireTenant(), which reads
 * the database.
 *
 * Checking only that a cookie existed let an expired or foreign one through:
 * the page shell rendered and every API call behind it failed, so the CRM
 * looked empty and broken rather than asking the user to sign in.
 */
export async function middleware(req: NextRequest) {
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
    "/api/vapi",
    // Twilio's "a call comes in" webhook; it proves itself with a signature.
    "/api/twilio",
    "/api/meta",
    "/api/auth",
    "/embed",
    "/login",
    "/widget.js",
    "/test-widget.html",
    "/favicon",
    // Phones fetch the manifest and icons without the session cookie, so
    // behind the login redirect they would get the login page instead and
    // the home-screen icon would never appear.
    "/manifest.webmanifest",
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
