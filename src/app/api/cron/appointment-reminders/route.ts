import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { timingSafeEqual, createHash } from "crypto";
import {
  describeAppointmentWhen,
  parseTimezone,
  zonedDateString,
  zonedWallTimeToUtc,
  parseDateOnly,
} from "@/lib/business-hours";
import { reminderBody, sendSms, smsConfigured } from "@/lib/sms";

/**
 * Day-before appointment reminders.
 *
 * Driven by cron rather than a scheduler in the app, because the app has no
 * durable job runner and a reminder that only fires while a process happens
 * to be up is worse than none.
 *
 * Safe to run repeatedly: `reminderSentAt` is stamped before the text is
 * attempted, so an overlapping or retried run cannot message the same client
 * twice. The cost of that choice is that a send failing mid-flight leaves the
 * reminder unsent — recorded in `reminderError` for staff to see. Texting
 * someone twice is worse than not texting them, since a duplicate reads as
 * disorganised and invites a phone call.
 */

const CRON_SECRET = process.env.CRON_SECRET;

function authorised(req: NextRequest): boolean {
  if (!CRON_SECRET) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(CRON_SECRET).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) {
    console.warn("[CRON] Rejected reminder run: bad or missing CRON_SECRET");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!smsConfigured()) {
    return NextResponse.json(
      { error: "Twilio is not configured", sent: 0 },
      { status: 503 }
    );
  }

  // `?date=YYYY-MM-DD` targets a specific day, for testing and for catching up
  // after a missed run.
  const explicitDate = new URL(req.url).searchParams.get("date");
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const orgs = await prisma.organizationSettings.findMany({
    where: { voiceEnabled: true },
    select: {
      organizationId: true,
      businessName: true,
      contactPhone: true,
      timezone: true,
    },
  });

  const summary: Array<Record<string, unknown>> = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const org of orgs) {
    const tz = parseTimezone(org.timezone);

    // "Tomorrow" is a local notion, and each organization may sit in its own
    // timezone, so the window is computed per org rather than once globally.
    const targetDate =
      explicitDate ??
      zonedDateString(new Date(Date.now() + 24 * 60 * 60 * 1000), tz);
    const { year, month, day } = parseDateOnly(targetDate);
    const from = zonedWallTimeToUtc(year, month, day, 0, 0, tz);
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    const due = await prisma.appointment.findMany({
      where: {
        organizationId: org.organizationId,
        status: "booked",
        reminderSentAt: null,
        startsAt: { gte: from, lt: to },
      },
      include: { lead: true },
    });

    for (const appt of due) {
      if (!appt.lead?.phone) {
        skipped++;
        continue;
      }

      if (dryRun) {
        summary.push({
          organizationId: org.organizationId,
          appointmentId: appt.id,
          to: appt.lead.phone,
          when: describeAppointmentWhen(appt.startsAt, tz),
          wouldSend: true,
        });
        continue;
      }

      // Stamp first. A duplicate text is worse than a missed one.
      await prisma.appointment.update({
        where: { id: appt.id },
        data: { reminderSentAt: new Date(), reminderError: null },
      });

      const result = await sendSms(
        org.organizationId,
        appt.lead.phone,
        reminderBody({
          clientName: appt.lead.name,
          serviceName: appt.serviceText,
          stylistName: appt.stylistName,
          whenText: describeAppointmentWhen(appt.startsAt, tz),
          businessName: org.businessName,
          contactPhone: org.contactPhone,
          bookingNumber: appt.bookingNumber,
        })
      );

      if (result.ok) {
        sent++;
      } else {
        failed++;
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderError: result.reason },
        });
        console.warn(
          `[CRON] Reminder failed for appointment ${appt.id}: ${result.reason}`
        );
      }

      summary.push({
        appointmentId: appt.id,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
      });
    }
  }

  console.log(
    `[CRON] Reminders — sent ${sent}, failed ${failed}, skipped ${skipped}${dryRun ? " (dry run)" : ""}`
  );

  return NextResponse.json({ dryRun, sent, failed, skipped, summary });
}

/** Liveness check for the cron entry, so a broken schedule is visible. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    smsConfigured: smsConfigured(),
    cronSecretSet: Boolean(CRON_SECRET),
  });
}
