/**
 * What the salon knows about a client from their bookings, in a line or a
 * tile: when they were last in, what they usually have and with whom, how
 * often they come, what they have spent, what they have next, and when they
 * are due back. Shown on the Clients list and profile, and beside a callback.
 *
 * "Due back" is the rebooking texts' own rule (src/lib/rebook.ts): their
 * latest completed visit, for a service with a rebook time, that many weeks
 * on. A salon that has set no rebook times has nobody due back.
 */

import { prisma } from "@/lib/prisma";
import { getSalonConfig } from "@/lib/booking";
import { zonedDateString } from "@/lib/business-hours";
import { dueDate, rebookServiceFor } from "@/lib/rebook";
import type { SalonService } from "@/lib/salon-config";

/** A booking, as far as a summary needs it. */
export interface VisitRow {
  serviceText: string;
  stylistName: string;
  startsAt: Date;
  status: string;
  amountMinor: number | null;
}

export interface VisitSummary {
  /** Their most recent visit that has happened (booked or completed, in the past). */
  lastVisit: Date | null;
  visits: number;
  /** What their completed visits were charged, in pence. */
  spentMinor: number;
  noShows: number;
  /** Their most common service lately, and who usually does it. */
  usual: { service: string; stylist: string } | null;
  /** The middle of the gaps between their visits, in days; null under two visits. */
  gapDays: number | null;
  next: { startsAt: Date; service: string; stylist: string } | null;
  /** When their last service says they are due back ("YYYY-MM-DD"), if it has a rebook time. */
  due: { on: string; service: string } | null;
}

/** Statuses that mean the client came in (or was due to): as the Clients list counts visits. */
const VISITED = new Set(["booked", "completed"]);
/** How many recent visits decide what they "usually" have. */
const USUAL_FROM = 10;

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  // `values` is newest first, so a tie goes to the more recent.
  for (const v of values) {
    const n = counts.get(v)!;
    if (n > most) {
      best = v;
      most = n;
    }
  }
  return best;
}

/** One client's bookings, summed up. Plain code, so it can be tested without a database. */
export function summariseVisits(
  rows: VisitRow[],
  now: Date,
  services: SalonService[],
  timeZone: string
): VisitSummary {
  const sorted = [...rows].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const past = sorted.filter((r) => VISITED.has(r.status) && r.startsAt < now);
  const completed = past.filter((r) => r.status === "completed");
  const upcoming = sorted
    .filter((r) => r.status === "booked" && r.startsAt >= now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const recent = past.slice(0, USUAL_FROM);
  const service = mostCommon(recent.map((r) => r.serviceText));
  const stylist = service ? mostCommon(recent.filter((r) => r.serviceText === service).map((r) => r.stylistName)) : null;

  let gapDays: number | null = null;
  if (past.length >= 2) {
    const gaps: number[] = [];
    for (let i = 0; i + 1 < past.length && i < USUAL_FROM; i++) {
      gaps.push((past[i].startsAt.getTime() - past[i + 1].startsAt.getTime()) / 86_400_000);
    }
    gaps.sort((a, b) => a - b);
    gapDays = Math.round(gaps[Math.floor(gaps.length / 2)]);
  }

  let due: VisitSummary["due"] = null;
  const latest = completed[0];
  if (latest && !upcoming.length) {
    const s = rebookServiceFor(latest.serviceText, services);
    if (s?.rebookWeeks) {
      due = { on: dueDate(zonedDateString(latest.startsAt, timeZone), s.rebookWeeks), service: s.rebookAs || s.name };
    }
  }

  const next = upcoming[0];
  return {
    lastVisit: past[0]?.startsAt ?? null,
    visits: past.length,
    spentMinor: completed.reduce((sum, r) => sum + (r.amountMinor ?? 0), 0),
    noShows: sorted.filter((r) => r.status === "no_show").length,
    usual: service && stylist ? { service, stylist } : null,
    gapDays,
    next: next ? { startsAt: next.startsAt, service: next.serviceText, stylist: next.stylistName } : null,
    due,
  };
}

/** Summaries for a page of clients, in one query. */
export async function visitSummaries(
  organizationId: string,
  leadIds: string[],
  now: Date = new Date(),
  config?: { services: SalonService[]; timeZone: string }
): Promise<Map<string, VisitSummary>> {
  const out = new Map<string, VisitSummary>();
  if (leadIds.length === 0) return out;
  const [rows, cfg] = await Promise.all([
    prisma.appointment.findMany({
      where: { organizationId, leadId: { in: leadIds } },
      select: { leadId: true, serviceText: true, stylistName: true, startsAt: true, status: true, amountMinor: true },
    }),
    config ?? getSalonConfig(organizationId),
  ]);
  const byLead = new Map<string, VisitRow[]>();
  for (const r of rows) {
    const list = byLead.get(r.leadId) ?? [];
    list.push(r);
    byLead.set(r.leadId, list);
  }
  for (const id of leadIds) out.set(id, summariseVisits(byLead.get(id) ?? [], now, cfg.services, cfg.timeZone));
  return out;
}

/** A summary as JSON for the screens: dates as ISO strings. */
export function summaryJson(s: VisitSummary) {
  return {
    lastVisit: s.lastVisit?.toISOString() ?? null,
    visits: s.visits,
    spentMinor: s.spentMinor,
    noShows: s.noShows,
    usual: s.usual,
    gapDays: s.gapDays,
    next: s.next ? { ...s.next, startsAt: s.next.startsAt.toISOString() } : null,
    due: s.due,
  };
}

export type VisitSummaryJson = ReturnType<typeof summaryJson>;

/** Due back from this many days ahead (as the rebooking texts give notice)… */
const DUE_AHEAD_DAYS = 3;
/** …until this long overdue, after which they show as not having been in. */
const DUE_LATE_DAYS = 56;

/**
 * The clients due back: their latest completed visit was for a service
 * with a rebook time, that time is up (or nearly), and nothing is booked.
 */
export async function dueBackLeadIds(
  organizationId: string,
  cfg: { services: SalonService[]; timeZone: string },
  now: Date = new Date()
): Promise<string[]> {
  const longest = Math.max(0, ...cfg.services.map((s) => s.rebookWeeks ?? 0));
  if (!longest) return [];
  const since = new Date(now.getTime() - (longest * 7 + DUE_LATE_DAYS + 1) * 86_400_000);
  const visits = await prisma.appointment.findMany({
    where: { organizationId, status: "completed", startsAt: { gte: since, lte: now }, lead: { anonymisedAt: null } },
    orderBy: { startsAt: "desc" },
    select: { leadId: true, serviceText: true, startsAt: true },
  });
  const latest = new Map<string, (typeof visits)[number]>();
  for (const v of visits) if (!latest.has(v.leadId)) latest.set(v.leadId, v);
  if (latest.size === 0) return [];

  const booked = await prisma.appointment.findMany({
    where: { organizationId, leadId: { in: [...latest.keys()] }, status: "booked", startsAt: { gte: now } },
    select: { leadId: true },
  });
  const hasNext = new Set(booked.map((b) => b.leadId));
  const from = zonedDateString(new Date(now.getTime() - DUE_LATE_DAYS * 86_400_000), cfg.timeZone);
  const until = zonedDateString(new Date(now.getTime() + DUE_AHEAD_DAYS * 86_400_000), cfg.timeZone);

  const out: string[] = [];
  for (const [leadId, v] of latest) {
    if (hasNext.has(leadId)) continue;
    const s = rebookServiceFor(v.serviceText, cfg.services);
    if (!s?.rebookWeeks) continue;
    const due = dueDate(zonedDateString(v.startsAt, cfg.timeZone), s.rebookWeeks);
    if (due >= from && due <= until) out.push(leadId);
  }
  return out;
}
