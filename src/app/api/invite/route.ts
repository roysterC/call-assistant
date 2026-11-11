import { NextRequest, NextResponse } from "next/server";
import { acceptInvitation, readInvitation } from "@/lib/invitations";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

/**
 * The invite link's page talks to this; no login, by design (src/proxy.ts).
 * Both ways are rate-limited by address, so the tokens cannot be guessed at
 * (they are 256 bits, but a guessing loop should still meet a wall).
 */

function limited(req: NextRequest): NextResponse | null {
  const { allowed, retryAfterMs } = rateLimit("invite", clientIpFromHeaders(req.headers), {
    tokens: 10,
    refillPerSecond: 1 / 30,
  });
  if (allowed) return null;
  return NextResponse.json(
    { error: "Too many tries. Wait a minute and try again." },
    { status: 429, headers: { "Retry-After": String(Math.ceil((retryAfterMs ?? 60_000) / 1000)) } }
  );
}

/** ?token= → which salon and address the link is for, or why it no longer works. */
export async function GET(req: NextRequest) {
  const tooMany = limited(req);
  if (tooMany) return tooMany;
  const result = await readInvitation(req.nextUrl.searchParams.get("token"));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ email: result.email, salon: result.salon });
}

/** { token, name, password } → the login is made; the page then signs in. */
export async function POST(req: NextRequest) {
  const tooMany = limited(req);
  if (tooMany) return tooMany;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await acceptInvitation({ token: body?.token, name: body?.name, password: body?.password });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ email: result.email });
  } catch (error) {
    console.error("[INVITE] accept error:", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
