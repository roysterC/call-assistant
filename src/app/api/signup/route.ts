import { NextRequest, NextResponse, after } from "next/server";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { signUpProblem, signUpSalon } from "@/lib/signup";
import { sendVerification } from "@/lib/auth-tokens";
import { emailAvailable } from "@/lib/email";
import { notifyKikai } from "@/lib/notify";
import { linkOrigin } from "@/lib/app-origin";

/**
 * A salon signing itself up (src/lib/signup.ts); no login, by design
 * (src/proxy.ts). Errors carry a `code` for the page to say in the reader's
 * language. The page then signs the owner in, and onboarding takes over.
 */
const TOO_MANY = { error: "Too many tries. Wait a while and try again.", code: "tooMany" };

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  // Tries of any kind: generous, so a few typos never lock a person out.
  if (!rateLimit("signup-try", ip, { tokens: 20, refillPerSecond: 1 / 180 }).allowed) {
    return NextResponse.json(TOO_MANY, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request", code: "invalid" }, { status: 400 });
  // The hidden field: a person never sees it, a bot fills everything.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ error: "Invalid request", code: "invalid" }, { status: 400 });
  }
  const input = { salon: body.salon, name: body.name, email: body.email, password: body.password, language: body.language };
  const problem = signUpProblem(input);
  if (problem) return NextResponse.json({ error: problem.error, code: problem.code }, { status: problem.status });
  // Salons made: a few an hour from one address, a wall for a script.
  if (!rateLimit("signup", ip, { tokens: 3, refillPerSecond: 1 / 1200 }).allowed) {
    return NextResponse.json(TOO_MANY, { status: 429 });
  }

  try {
    const r = await signUpSalon(input);
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    const origin = linkOrigin(req.nextUrl.origin);
    after(async () => {
      // So they can reset their password with it if they ever forget it.
      if (emailAvailable()) await sendVerification(r.userId, origin).catch(() => {});
      await notifyKikai({
        subject: `${r.salon} signed up`,
        lines: [`${r.salon} signed up on its own (${r.email}) and is on the 14-day free trial, setting up now.`],
        button: "Open the salon in Admin",
        url: `${origin}/admin/organizations/${r.organizationId}`,
      });
    });
    return NextResponse.json({ email: r.email }, { status: 201 });
  } catch (error) {
    console.error("[SIGNUP] error:", error);
    return NextResponse.json({ error: "Something went wrong. Try again.", code: "failed" }, { status: 500 });
  }
}
