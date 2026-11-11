import { NextRequest, NextResponse } from "next/server";
import { renewExpiredInvitation } from "@/lib/invitations";
import { linkOrigin } from "@/lib/app-origin";
import { inviteRateLimited as limited } from "@/lib/invite-rate-limit";

/**
 * { token } of an expired invite → a fresh link, emailed to the address the
 * old one was for (never anywhere else). Says the same whatever happened, so
 * it tells nobody anything about the link.
 */
export async function POST(req: NextRequest) {
  const tooMany = limited(req);
  if (tooMany) return tooMany;
  const body = await req.json().catch(() => ({}));
  try {
    await renewExpiredInvitation(body?.token, linkOrigin(req.nextUrl.origin));
  } catch (error) {
    console.error("[INVITE] renew error:", error);
  }
  return NextResponse.json({ ok: true });
}
