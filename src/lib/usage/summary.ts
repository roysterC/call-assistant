/**
 * Calls, minutes and money for a salon over a period.
 *
 * Two sources, added together: Vapi calls, whose cost Vapi reports and we keep
 * on Call (in US cents), and our own receptionist, whose cost we work out and
 * keep on UsageRecord. Lab usage is kept apart: it is on our bill but it is our
 * testing, so it is never part of what the salon is charged.
 */

import { prisma } from "@/lib/prisma";
import { chargeFor } from "./cost";

export interface UsageTotals {
  calls: number;
  seconds: number;
  /** Our cost, US dollar micros. */
  costMicros: number;
  vapiCostMicros: number;
  receptionistCostMicros: number;
}

export interface OrgUsage extends UsageTotals {
  organizationId: string;
  markupPercent: number | null;
  /** What the salon is charged, US dollar micros; null when unpriced. */
  chargeMicros: number | null;
  lab: { conversations: number; seconds: number; costMicros: number };
}

const CENTS_TO_MICROS = 10_000;

export async function summariseUsage(
  organizationIds: string[],
  from: Date,
  to: Date
): Promise<Map<string, OrgUsage>> {
  const within = { gte: from, lt: to };
  const [orgs, vapi, ours, labVoice, labChat] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { id: true, usageMarkupPercent: true },
    }),
    prisma.call.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: organizationIds }, createdAt: within },
      _count: { _all: true },
      _sum: { duration: true, costCents: true },
    }),
    prisma.usageRecord.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: organizationIds }, startedAt: within, source: "phone" },
      _count: { _all: true },
      _sum: { durationSeconds: true, costMicros: true },
    }),
    prisma.usageRecord.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: organizationIds }, startedAt: within, source: "lab_voice" },
      _count: { _all: true },
      _sum: { durationSeconds: true, costMicros: true },
    }),
    // A typed lab conversation is several rows, one per turn.
    prisma.usageRecord.groupBy({
      by: ["organizationId", "sessionKey"],
      where: { organizationId: { in: organizationIds }, startedAt: within, source: "lab_chat" },
      _sum: { costMicros: true },
    }),
  ]);

  const out = new Map<string, OrgUsage>();
  for (const org of orgs) {
    const v = vapi.find((r) => r.organizationId === org.id);
    const o = ours.find((r) => r.organizationId === org.id);
    const lv = labVoice.find((r) => r.organizationId === org.id);
    const lc = labChat.filter((r) => r.organizationId === org.id);

    const vapiCostMicros = (v?._sum.costCents ?? 0) * CENTS_TO_MICROS;
    const receptionistCostMicros = o?._sum.costMicros ?? 0;
    const costMicros = vapiCostMicros + receptionistCostMicros;

    out.set(org.id, {
      organizationId: org.id,
      calls: (v?._count._all ?? 0) + (o?._count._all ?? 0),
      seconds: (v?._sum.duration ?? 0) + (o?._sum.durationSeconds ?? 0),
      costMicros,
      vapiCostMicros,
      receptionistCostMicros,
      markupPercent: org.usageMarkupPercent,
      chargeMicros: chargeFor(costMicros, org.usageMarkupPercent),
      lab: {
        conversations: (lv?._count._all ?? 0) + lc.length,
        seconds: lv?._sum.durationSeconds ?? 0,
        costMicros: (lv?._sum.costMicros ?? 0) + lc.reduce((t, r) => t + (r._sum.costMicros ?? 0), 0),
      },
    });
  }
  return out;
}

/** Per-call and per-minute figures, null where there is nothing to divide by. */
export function perUnit(micros: number | null, calls: number, seconds: number) {
  if (micros === null) return { perCall: null, perMinute: null };
  return {
    perCall: calls ? micros / calls : null,
    perMinute: seconds ? micros / (seconds / 60) : null,
  };
}
