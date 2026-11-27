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

/** Which reminder is due now, if any: the day-before one wins over a missed three-day one. */
export function trialReminderDue(
  o: { billingStatus: string; trialEndsAt: Date | null; stripeSubscriptionId: string | null; trialReminderSent: string | null },
  now: Date = new Date()
): TrialStage | null {
  const plan = planState({ ...o, addons: [] }, now);
  if (plan.status !== "trialing" || plan.hasCard || plan.trialDaysLeft === null) return null;
  if (plan.trialDaysLeft <= 1) return o.trialReminderSent === "1" ? null : "1";
  if (plan.trialDaysLeft <= 3) return o.trialReminderSent ? null : "3";
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
    for (const owner of org.users) {
      const lang: Lang = isLang(owner.language) ? owner.language : DEFAULT_LANG;
      const date = org.trialEndsAt!.toLocaleDateString(INTL_LOCALE[lang], { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
      const r = await sendEmail(
        actionEmail({
          to: owner.email,
          subject: translate(lang, stage === "3" ? "mail.trial.subject3" : "mail.trial.subject1"),
          heading: translate(lang, stage === "3" ? "mail.trial.heading3" : "mail.trial.heading1"),
          lines: [translate(lang, "mail.trial.line", { salon: org.name, date }), translate(lang, "mail.trial.lineAfter")],
          button: translate(lang, "mail.trial.button"),
          url: `${origin}/settings#plan`,
          footer: translate(lang, "mail.trial.footer", { salon: org.name }),
          copyLine: translate(lang, "mail.copy"),
          lang,
        })
      );
      if (r.ok) sent++;
      else {
        failed++;
        console.error(`[TRIAL REMINDER] ${org.id} to an owner failed: ${r.error}`);
      }
    }
  }
  return { sent, failed };
}
