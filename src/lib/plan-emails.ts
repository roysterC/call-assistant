/**
 * "Your free trial is ending" emails, for the owner of a salon on its trial
 * with no card (Stripe only reminds salons that have one). Two: three days
 * before the end, and the day before. Sent by the daily timer
 * (/api/cron/trial-reminders), each at most once per trial: moving the
 * trial's end clears what was sent.
 */

import { prisma } from "@/lib/prisma";
import { actionEmail, sendEmail } from "@/lib/email";
import { DEFAULT_LANG, INTL_LOCALE, isLang, type Lang } from "@/lib/i18n";
import { translate } from "@/lib/i18n/server";
import { planState } from "@/lib/plan";

export type TrialStage = "3" | "1";

/** The date in London, as "2026-12-01". */
function londonDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** Whole calendar days in London from today to the trial's last day: 0 on that day. */
export function daysToTrialEnd(trialEndsAt: Date, now: Date = new Date()): number {
  return Math.round((Date.parse(londonDay(trialEndsAt)) - Date.parse(londonDay(now))) / (24 * 60 * 60 * 1000));
}

/**
 * Which reminder is due now, if any, by London calendar days, so "ends
 * tomorrow" always goes the day before: three days before (or two, if the
 * first run missed it), then the day before (or on the day, if missed).
 */
export function trialReminderDue(
  o: { billingStatus: string; trialEndsAt: Date | null; stripeSubscriptionId: string | null; trialReminderSent: string | null },
  now: Date = new Date()
): TrialStage | null {
  const plan = planState({ ...o, addons: [] }, now);
  if (plan.status !== "trialing" || plan.hasCard || !o.trialEndsAt) return null;
  const days = daysToTrialEnd(o.trialEndsAt, now);
  if (days < 0) return null;
  if (days <= 1) return o.trialReminderSent === "1" ? null : "1";
  if (days <= 3) return o.trialReminderSent ? null : "3";
  return null;
}

/** Email every salon whose reminder is due. */
export async function sendTrialReminders(origin: string, now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const orgs = await prisma.organization.findMany({
    where: { billingStatus: "trialing", stripeSubscriptionId: null, trialEndsAt: { not: null, gt: now }, enabled: true },
    select: {
      id: true,
      name: true,
      billingStatus: true,
      trialEndsAt: true,
      stripeSubscriptionId: true,
      trialReminderSent: true,
      users: { where: { role: "admin" }, select: { email: true, language: true } },
    },
  });
  let sent = 0;
  let failed = 0;
  for (const org of orgs) {
    const stage = trialReminderDue(org, now);
    if (!stage || !org.users.length) continue;
    // Claimed first, so two runs at once send it once.
    const claimed = await prisma.organization.updateMany({
      where: { id: org.id, trialReminderSent: org.trialReminderSent },
      data: { trialReminderSent: stage },
    });
    if (claimed.count !== 1) continue;
    let reached = false;
    for (const owner of org.users) {
      const lang: Lang = isLang(owner.language) ? owner.language : DEFAULT_LANG;
      const date = org.trialEndsAt!.toLocaleDateString(INTL_LOCALE[lang], { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
      const days = daysToTrialEnd(org.trialEndsAt!, now);
      const r = await sendEmail(
        actionEmail({
          to: owner.email,
          subject: translate(lang, "mail.trial.subject", { days }),
          heading: translate(lang, "mail.trial.heading", { days }),
          lines: [translate(lang, "mail.trial.line", { salon: org.name, date }), translate(lang, "mail.trial.lineAfter")],
          button: translate(lang, "mail.trial.button"),
          url: `${origin}/settings#plan`,
          footer: translate(lang, "mail.trial.footer", { salon: org.name }),
          copyLine: translate(lang, "mail.copy"),
          lang,
        })
      );
      if (r.ok) {
        sent++;
        reached = true;
      } else {
        failed++;
        console.error(`[TRIAL REMINDER] ${org.id} to an owner failed: ${r.error}`);
      }
    }
    // Nobody reached: not sent, so the next run tries again.
    if (!reached) {
      await prisma.organization.updateMany({
        where: { id: org.id, trialReminderSent: stage },
        data: { trialReminderSent: org.trialReminderSent },
      });
    }
  }
  return { sent, failed };
}
