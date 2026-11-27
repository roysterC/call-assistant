import { NextRequest, NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { linkOrigin } from "@/lib/app-origin";
import { notifyKikai } from "@/lib/notify";
import { purgePaused } from "@/lib/purge";

/**
 * Wiping paused salons, least recently used first, once the database is over
 * PURGE_WHEN_DB_OVER_GB (src/lib/purge.ts). Run nightly by the reminders
 * timer (scripts/send-reminders.sh). `?dryRun=1` says what is a candidate
 * and changes nothing.
 */
export async function POST(req: NextRequest) {
  if (!cronAuthorised(req)) {
    console.warn("[CRON] Rejected purge run: bad or missing CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const origin = linkOrigin(req.nextUrl.origin);
  const report = await purgePaused(origin, new Date(), { dryRun });
  if (report.warned.length || report.deleted.length || report.errors.length) {
    await notifyKikai({
      subject: `Paused salons: ${report.deleted.length} deleted, ${report.warned.length} warned`,
      lines: [
        `The database is ${(report.databaseBytes / 1024 ** 3).toFixed(1)} GB, over the ${((report.limitBytes ?? 0) / 1024 ** 3).toFixed(1)} GB set in PURGE_WHEN_DB_OVER_GB.`,
        ...(report.deleted.length ? [`Deleted: ${report.deleted.join(", ")}.`] : []),
        ...(report.warned.length ? [`Warned (deleted in 14 days unless used or paid): ${report.warned.join(", ")}.`] : []),
        ...report.errors.map((e) => `Failed: ${e}`),
      ],
      button: "Open Admin",
      url: `${origin}/admin/organizations`,
    });
  }
  return NextResponse.json(report);
}
