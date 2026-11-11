import { NextRequest, NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { emailConfigured } from "@/lib/email";
import { linkOrigin } from "@/lib/app-origin";
import { remindStalledInvitations, REMIND_AFTER_DAYS } from "@/lib/invitations";

/**
 * One reminder, with a fresh link, for each emailed invitation nobody has
 * used after REMIND_AFTER_DAYS (src/lib/invitations.ts). Run daily by the
 * same timer as the appointment reminders (scripts/send-reminders.sh); safe
 * to run more often, since each person is only ever reminded once.
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) {
    console.warn("[CRON] Rejected invite reminders: bad or missing CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!emailConfigured()) {
    return NextResponse.json({ error: "Email is not set up", sent: 0 }, { status: 503 });
  }
  const result = await remindStalledInvitations(linkOrigin(req.nextUrl.origin));
  console.log(`[CRON] Invite reminders (after ${REMIND_AFTER_DAYS} days) — sent ${result.sent}, failed ${result.failed}`);
  return NextResponse.json(result);
}
