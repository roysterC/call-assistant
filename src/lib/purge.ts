/**
 * Wiping paused salons as the database fills: the least recently used first.
 *
 * A salon is a candidate while its plan is paused (src/lib/plan.ts: the
 * trial ended with no card, Stripe gave up, or a cancelled plan ran out) and
 * nobody at it has used the app for IDLE_DAYS (lastActiveAt, src/lib/tenant.ts).
 * Salons Kikai does not bill, and ones Kikai switched off, are never wiped.
 *
 * Nothing happens until the database is over PURGE_WHEN_DB_OVER_GB. Then,
 * each night (the reminders timer, /api/cron/purge-paused), oldest first:
 *  - a candidate not yet warned: its owner is emailed that it will be
 *    deleted in WARN_DAYS, unless they sign in or add a card (either one
 *    clears the warning);
 *  - one warned WARN_DAYS ago or more: deleted, with its logins (as Admin's
 *    Delete does), after any Stripe subscription it still has is cancelled.
 * At most PER_RUN of each a night, since Postgres only gives space back
 * after a vacuum, so the size cannot be watched falling salon by salon.
 * Kikai is emailed what was warned and deleted.
 */

import { prisma } from "@/lib/prisma";
import { actionEmail, sendEmail } from "@/lib/email";
import { DEFAULT_LANG, INTL_LOCALE, isLang, type Lang } from "@/lib/i18n";
import { translate } from "@/lib/i18n/server";
import { planState } from "@/lib/plan";
import { stopBillingForFree, stripeConfigured } from "@/lib/stripe-billing";

export const IDLE_DAYS = 90;
export const WARN_DAYS = 14;
export const PER_RUN = 5;
const DAY = 24 * 60 * 60 * 1000;

/** The size past which paused salons are wiped, in bytes; null (never) when not set. */
export function purgeLimitBytes(raw: string | undefined = process.env.PURGE_WHEN_DB_OVER_GB): number | null {
  const gb = Number(raw);
  return raw && Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1024 ** 3) : null;
}

export async function databaseBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`;
  return Number(rows[0]?.size ?? 0);
}

export interface PurgeReport {
  databaseBytes: number;
  limitBytes: number | null;
  over: boolean;
  candidates: number;
  warned: string[];
  deleted: string[];
  errors: string[];
}

export async function purgePaused(origin: string, now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<PurgeReport> {
  const limitBytes = purgeLimitBytes();
  const size = await databaseBytes();
  const report: PurgeReport = { databaseBytes: size, limitBytes, over: limitBytes !== null && size > limitBytes, candidates: 0, warned: [], deleted: [], errors: [] };

  const idleSince = new Date(now.getTime() - IDLE_DAYS * DAY);
  const orgs = await prisma.organization.findMany({
    where: { enabled: true, billingStatus: { not: "free" }, lastActiveAt: { lt: idleSince } },
    orderBy: { lastActiveAt: "asc" },
    select: {
      id: true,
      name: true,
      billingStatus: true,
      trialEndsAt: true,
      stripeSubscriptionId: true,
      addons: true,
      purgeWarnedAt: true,
      users: { where: { role: "admin" }, select: { email: true, language: true } },
    },
  });
  const paused = orgs.filter((o) => planState(o, now).access === "restricted");
  report.candidates = paused.length;
  if (!report.over || opts.dryRun) return report;

  const due = new Date(now.getTime() - WARN_DAYS * DAY);
  for (const org of paused.filter((o) => o.purgeWarnedAt && o.purgeWarnedAt <= due).slice(0, PER_RUN)) {
    try {
      // A paused subscription Stripe still holds (unpaid) is cancelled first,
      // so nothing is ever charged for a salon that no longer exists.
      if (org.stripeSubscriptionId && stripeConfigured()) {
        const stopped = await stopBillingForFree(org.id);
        if (!stopped.ok) throw new Error(`Stripe: ${stopped.error}`);
      }
      await prisma.$transaction([
        prisma.user.deleteMany({ where: { organizationId: org.id, role: { not: "superAdmin" } } }),
        prisma.organization.delete({ where: { id: org.id } }),
      ]);
      report.deleted.push(org.name);
    } catch (e) {
      report.errors.push(`${org.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const org of paused.filter((o) => !o.purgeWarnedAt).slice(0, PER_RUN)) {
    const claimed = await prisma.organization.updateMany({ where: { id: org.id, purgeWarnedAt: null }, data: { purgeWarnedAt: now } });
    if (claimed.count !== 1) continue;
    const when = new Date(now.getTime() + WARN_DAYS * DAY);
    for (const owner of org.users) {
      const lang: Lang = isLang(owner.language) ? owner.language : DEFAULT_LANG;
      const date = when.toLocaleDateString(INTL_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
      const sent = await sendEmail(
        actionEmail({
          to: owner.email,
          subject: translate(lang, "mail.purge.subject", { date }),
          heading: translate(lang, "mail.purge.heading", { salon: org.name, date }),
          lines: [translate(lang, "mail.purge.line", { salon: org.name, date }), translate(lang, "mail.purge.lineKeep")],
          button: translate(lang, "mail.purge.button"),
          url: `${origin}/settings#plan`,
          footer: translate(lang, "mail.purge.footer", { salon: org.name }),
          copyLine: translate(lang, "mail.copy"),
          lang,
        })
      );
      if (!sent.ok) report.errors.push(`${org.name}: warning email failed: ${sent.error}`);
    }
    report.warned.push(org.name);
  }
  return report;
}

