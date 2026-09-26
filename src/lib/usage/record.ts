/**
 * Writing down what our receptionist used, as it finishes.
 *
 * Never allowed to break a call: a failure to record is logged and dropped.
 * An undercounted call is a smaller problem than a caller hung up on because
 * the bookkeeping failed.
 */

import { prisma } from "@/lib/prisma";
import { costOf, type UsageCounts } from "./cost";

export type UsageSource = "lab_voice" | "lab_chat" | "phone";

export async function recordUsage(
  organizationId: string,
  entry: {
    source: UsageSource;
    sessionKey?: string | null;
    startedAt: Date;
    durationSeconds?: number;
    counts: UsageCounts;
  }
): Promise<number | null> {
  const cost = costOf(entry.counts);
  try {
    await prisma.usageRecord.create({
      data: {
        organizationId,
        source: entry.source,
        sessionKey: entry.sessionKey ?? null,
        startedAt: entry.startedAt,
        durationSeconds: Math.max(0, Math.round(entry.durationSeconds ?? 0)),
        model: entry.counts.model ?? null,
        inputTokens: entry.counts.inputTokens ?? 0,
        outputTokens: entry.counts.outputTokens ?? 0,
        cacheReadTokens: entry.counts.cacheReadTokens ?? 0,
        cacheWriteTokens: entry.counts.cacheWriteTokens ?? 0,
        sttSeconds: entry.counts.sttSeconds ?? 0,
        ttsCharacters: entry.counts.ttsCharacters ?? 0,
        telephonySeconds: Math.round(entry.counts.telephonySeconds ?? 0),
        costMicros: cost.total,
      },
    });
    return cost.total;
  } catch (err) {
    console.error("[USAGE] could not record usage:", err);
    return null;
  }
}
