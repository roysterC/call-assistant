import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge-runtime middleware.
 *
 * Cannot import the full NextAuth config here because the Prisma adapter
 * uses Node-only modules. Instead we check for the session cookie and defer
 * the actual session validation to route handlers via requireTenant().
 */
export function middleware(req: NextRequest) {
  // Dev-only bypass for local preview with no real session.
  // Guarded by an env var that is only set in .env.local (gitignored).
  if (process.env.DEV_BYPASS_AUTH === "1") {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  // Public routes - no auth required
  const publicPrefixes = [
    "/api/website-chat",
    "/api/whatsapp",
    "/api/vapi",
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
  if (publicPrefixes.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for a session cookie (NextAuth v5 default names)
  const cookie =
    req.cookies.get("authjs.session-token")?.value ||
    req.cookies.get("__Secure-authjs.session-token")?.value;

  if (!cookie) {
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:js|css|png|jpg|jpeg|svg|ico|html)$).*)",
  ],
};
