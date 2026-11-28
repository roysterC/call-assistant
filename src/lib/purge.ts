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
 *  - one warned WARN_DAYS ago or more (and not over twice that, which is
 *    warned again): deleted, with its logins (as Admin's Delete does), after
 *    any Stripe subscription it still has is cancelled.
 * At most PER_RUN of each a run (the timer runs twice a day), since Postgres
 * only gives space back after a vacuum, so the size cannot be watched
 * falling salon by salon. A salon still in use by its clients (bookings to
 * come, or made in IDLE_DAYS) is never a candidate. A warning counts only if
 * an email reached the owner; under the limit, warnings are withdrawn.
 * Kikai is emailed what was warned and deleted.
 */

import { prisma } from "@/lib/prisma";
import { actionEmail, emailConfigured, sendEmail } from "@/lib/email";
import { DEFAULT_LANG, INTL_LOCALE, isLang, type Lang } from "@/lib/i18n";
import { translate } from "@/lib/i18n/server";
import { planState } from "@/lib/plan";
import { cancelSubscriptionNow, stripeConfigured } from "@/lib/stripe-billing";

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
  /** Paused, idle salons, least recently used first. */
  candidates: string[];
  /** On a dry run, what this run would do. */
  wouldWarn: string[];
  wouldDelete: string[];
  warned: string[];
  deleted: string[];
  /** Warnings withdrawn: the database is back under its limit, or the warning is too old to act on. */
  cleared: number;
  errors: string[];
}

export async function purgePaused(origin: string, now: Date = new Date(), opts: { dryRun?: boolean } = {}): Promise<PurgeReport> {
  const limitBytes = purgeLimitBytes();
  const size = await databaseBytes();
  const report: PurgeReport = {
    databaseBytes: size,
    limitBytes,
    over: limitBytes !== null && size > limitBytes,
    candidates: [],
    wouldWarn: [],
    wouldDelete: [],
    warned: [],
    deleted: [],
    cleared: 0,
    errors: [],
  };

  const idleSince = new Date(now.getTime() - IDLE_DAYS * DAY);
  // In use is in use: a salon whose clients still book (its website stays
  // open while paused), or that has bookings to come, is never a candidate.
  const notInUse = {
    enabled: true,
    billingStatus: { not: "free" },
    lastActiveAt: { lt: idleSince },
    appointments: { none: { OR: [{ startsAt: { gte: now } }, { createdAt: { gte: idleSince } }] } },
  };
  const orgs = await prisma.organization.findMany({
    where: notInUse,
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
  report.candidates = paused.map((o) => o.name);

  // Under the limit, warnings are withdrawn: a warning only ever leads to a
  // deletion while it is current. One older than twice the notice is
  // withdrawn too, and given again before anything happens.
  const stale = new Date(now.getTime() - 2 * WARN_DAYS * DAY);
  if (!opts.dryRun) {
    const cleared = await prisma.organization.updateMany({
      where: { purgeWarnedAt: report.over ? { lt: stale } : { not: null } },
      data: { purgeWarnedAt: null },
    });
    report.cleared = cleared.count;
  }
  if (!report.over) return report;
  // What was just withdrawn reads as withdrawn below, so a stale warning is
  // given again this run (its claim expects none).
  for (const o of paused) if (o.purgeWarnedAt && o.purgeWarnedAt < stale) o.purgeWarnedAt = null;

  const due = new Date(now.getTime() - WARN_DAYS * DAY);
  const toDelete = paused.filter((o) => o.purgeWarnedAt && o.purgeWarnedAt <= due && o.purgeWarnedAt >= stale).slice(0, PER_RUN);
  // Every unwarned candidate, in order: the run warns up to PER_RUN of them,
  // passing over any it cannot reach, so those never hold up the rest.
  const toWarn = paused.filter((o) => !o.purgeWarnedAt);
  if (opts.dryRun) {
    report.wouldDelete = toDelete.map((o) => o.name);
    report.wouldWarn = toWarn.filter((o) => o.users.length).slice(0, PER_RUN).map((o) => o.name);
    return report;
  }

  for (const org of toDelete) {
    try {
      // Still as it was when read: warned then, unused since, nothing booked.
      // And still paused: a salon back on a trial, or paying, is not wiped.
      const still = await prisma.organization.findFirst({
        where: { id: org.id, purgeWarnedAt: org.purgeWarnedAt, ...notInUse },
        select: { billingStatus: true, trialEndsAt: true, stripeSubscriptionId: true, addons: true },
      });
      if (!still || planState(still, now).access !== "restricted") continue;
      // Stripe first, so nothing is ever charged for a salon that no longer
      // exists; ours is left alone until the delete, so a failure leaves the
      // salon paused, never free. A live subscription we cannot cancel (Stripe
      // not set up here) keeps the salon.
      if (still.stripeSubscriptionId) {
        if (!stripeConfigured()) throw new Error("it has a Stripe subscription and Stripe is not set up here; left alone");
        await cancelSubscriptionNow(still.stripeSubscriptionId);
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

  // A warning counts only once an owner has been sent it.
  if (!emailConfigured()) {
    if (toWarn.length) report.errors.push(`Email is not set up: ${toWarn.length} salon(s) not warned, so none will be deleted.`);
    return report;
  }
  const unreachable: string[] = [];
  for (const org of toWarn) {
    if (report.warned.length >= PER_RUN) break;
    if (!org.users.length) {
      unreachable.push(org.name);
      continue;
    }
    const claimed = await prisma.organization.updateMany({
      where: { id: org.id, purgeWarnedAt: org.purgeWarnedAt },
      data: { purgeWarnedAt: now },
    });
    if (claimed.count !== 1) continue;
    const when = new Date(now.getTime() + WARN_DAYS * DAY);
    let sentAny = false;
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
      if (sent.ok) sentAny = true;
      else report.errors.push(`${org.name}: warning email failed: ${sent.error}`);
    }
    if (sentAny) report.warned.push(org.name);
    // Nobody told, nobody warned: tried again next run.
    else await prisma.organization.update({ where: { id: org.id }, data: { purgeWarnedAt: null } });
  }
  if (unreachable.length) {
    report.errors.push(`No owner login to warn, so left alone: ${unreachable.slice(0, 10).join(", ")}${unreachable.length > 10 ? ` and ${unreachable.length - 10} more` : ""}.`);
  }
  return report;
}
