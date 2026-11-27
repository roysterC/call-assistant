import { NextRequest, NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { emailConfigured } from "@/lib/email";
import { linkOrigin } from "@/lib/app-origin";
import { sendTrialReminders } from "@/lib/plan-emails";

/**
 * "Your free trial is ending" emails to owners with no card
 * (src/lib/plan-emails.ts). Run daily by the reminders timer
 * (scripts/send-reminders.sh); safe to run more often, since each email goes
 * once per trial.
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) {
    console.warn("[CRON] Rejected trial reminders: bad or missing CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!emailConfigured()) return NextResponse.json({ error: "Email is not set up", sent: 0 }, { status: 503 });
  const result = await sendTrialReminders(linkOrigin(req.nextUrl.origin));
  console.log(`[CRON] Trial reminders — sent ${result.sent}, failed ${result.failed}`);
  return NextResponse.json(result);
}
