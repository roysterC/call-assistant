import { NextRequest, NextResponse, after } from "next/server";
import { checkAuthToken, requestPasswordReset, resetPassword } from "@/lib/auth-tokens";
import { normaliseEmail } from "@/lib/invitations";
import { linkOrigin } from "@/lib/app-origin";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * "Forgot password?", with no login by design (src/proxy.ts). Rate-limited by
 * address and by the email asked about, so it can be used neither to guess
 * links nor to fill someone's inbox.
 */

function tooMany(req: NextRequest, extraKey?: string): NextResponse | null {
  const byIp = rateLimit("password-reset", clientIpFromHeaders(req.headers), { tokens: 10, refillPerSecond: 1 / 60 });
  const byEmail = extraKey ? rateLimit("password-reset-email", extraKey, { tokens: 3, refillPerSecond: 1 / 600 }) : { allowed: true };
  if (byIp.allowed && byEmail.allowed) return null;
  return NextResponse.json({ error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });
}

/** { email }: send a link if it has a login. The answer is the same either way. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter the email you sign in with." }, { status: 400 });
  const limited = tooMany(req, email);
  if (limited) return limited;
  const origin = linkOrigin(req.nextUrl.origin);
  // After the answer has gone, so how long it takes says nothing about
  // whether the address has a login.
  after(() => requestPasswordReset(email, origin).catch((e) => console.error("[PASSWORD RESET] request failed:", e)));
  return NextResponse.json({ ok: true });
}

/** ?token= → whether the link still works, for the page to show the form or say why not. */
export async function GET(req: NextRequest) {
  const limited = tooMany(req);
  if (limited) return limited;
  const problem = await checkAuthToken(req.nextUrl.searchParams.get("token"), "reset");
  if (problem) return NextResponse.json({ error: problem.error, code: problem.code }, { status: problem.status });
  return NextResponse.json({ ok: true });
}

/** { token, password } → set it; the page then signs in. */
export async function PUT(req: NextRequest) {
  const limited = tooMany(req);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await resetPassword(body?.token, body?.password);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ email: result.email });
  } catch (error) {
    console.error("[PASSWORD RESET] reset failed:", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
