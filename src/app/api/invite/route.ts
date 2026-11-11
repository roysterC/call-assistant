import { NextRequest, NextResponse, after } from "next/server";
import { acceptInvitation, readInvitation } from "@/lib/invitations";
import { inviteRateLimited as limited } from "@/lib/invite-rate-limit";
import { notifyKikai } from "@/lib/notify";
import { linkOrigin } from "@/lib/app-origin";

/**
 * The invite link's page talks to this; no login, by design (src/proxy.ts).
 * Rate-limited by address, so the tokens cannot be guessed at (they are 256
 * bits, but a guessing loop should still meet a wall). Errors carry a `code`
 * for the page to say in the reader's language.
 */

/** ?token= → which salon and address the link is for, or why it no longer works. */
export async function GET(req: NextRequest) {
  const tooMany = limited(req);
  if (tooMany) return tooMany;
  const result = await readInvitation(req.nextUrl.searchParams.get("token"));
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json({ email: result.email, salon: result.salon, role: result.role, language: result.language });
}

/** { token, name, password, language? } → the login is made; the page then signs in. */
export async function POST(req: NextRequest) {
  const tooMany = limited(req);
  if (tooMany) return tooMany;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await acceptInvitation({
      token: body?.token,
      name: body?.name,
      password: body?.password,
      language: body?.language,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    if (result.role === "admin") {
      const origin = linkOrigin(req.nextUrl.origin);
      after(() =>
        notifyKikai({
          subject: `${result.name} joined ${result.salon}`,
          lines: [
            `${result.name} (${result.email}) made their owner's login for ${result.salon}, and is setting the salon up now.`,
          ],
          button: "Open the salon in Admin",
          url: `${origin}/admin/organizations/${result.organizationId}`,
        })
      );
    }
    return NextResponse.json({ email: result.email });
  } catch (error) {
    console.error("[INVITE] accept error:", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
