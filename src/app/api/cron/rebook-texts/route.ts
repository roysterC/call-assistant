import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cronAuthorised } from "@/lib/cron-auth";
import { smsConfigured } from "@/lib/sms";
import { runRebookTexts, type RunSummary } from "@/lib/rebook";

/**
 * Rebooking texts (src/lib/rebook.ts), for every salon that switched them on.
 * Run by the same timer as the day-before reminders (send-reminders.sh).
 *
 * Safe to run more than once a day: a visit is only ever texted about once,
 * and a client at most once a fortnight.
 *
 * `?dryRun=1` lists who would be texted, and the text, without sending.
 * `?org=<id>` runs one salon only.
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) {
    console.warn("[CRON] Rejected rebook run: bad or missing CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const only = params.get("org");

  if (!dryRun && !smsConfigured()) {
    return NextResponse.json({ error: "Twilio is not configured", sent: 0 }, { status: 503 });
  }

  const orgs = await prisma.organizationSettings.findMany({
    where: { rebookTextsEnabled: true, ...(only ? { organizationId: only } : {}) },
    select: { organizationId: true },
  });

  const salons: RunSummary[] = [];
  for (const { organizationId } of orgs) {
    try {
      salons.push(await runRebookTexts(organizationId, { dryRun }));
    } catch (err) {
      // One salon's bad data must not stop the others' texts.
      console.error(`[CRON] Rebook run failed for ${organizationId}:`, err);
      salons.push({ organizationId, skipped: "the run failed; see the server log", due: 0, sent: 0, failed: 0 });
    }
  }

  const sent = salons.reduce((n, s) => n + s.sent, 0);
  const failed = salons.reduce((n, s) => n + s.failed, 0);
  console.log(`[CRON] Rebook texts — sent ${sent}, failed ${failed}${dryRun ? " (dry run)" : ""}`);
  return NextResponse.json({ dryRun, sent, failed, salons });
}
