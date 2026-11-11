import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isCurrentSession } from "@/lib/session-version";
import { sendVerification } from "@/lib/auth-tokens";
import { linkOrigin } from "@/lib/app-origin";
import { rateLimit } from "@/lib/rate-limit";

/** Whether this login's email is confirmed: GET. Send the link to confirm it: POST. */

async function signedIn() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, emailVerified: true, sessionVersion: true },
  });
  if (!user || !isCurrentSession(session.user.sessionVersion, user.sessionVersion)) return null;
  return user;
}

export async function GET() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ email: user.email, verified: Boolean(user.emailVerified) });
}

export async function POST(req: NextRequest) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allowed } = rateLimit("verify-email-send", user.id, { tokens: 3, refillPerSecond: 1 / 600 });
  if (!allowed) return NextResponse.json({ error: "We've just sent one. Check your inbox, or try again in a few minutes." }, { status: 429 });
  const result = await sendVerification(user.id, linkOrigin(req.nextUrl.origin));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, email: user.email });
}
