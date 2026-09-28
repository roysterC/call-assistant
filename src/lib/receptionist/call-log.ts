/**
 * One line in Call History per call our receptionist answers: who rang, when,
 * for how long, and what it came to. Nothing of what was said is kept.
 *
 * Lab calls are never logged: they are Kikai's tests, not the salon's
 * callers. The phone line calls this when a call ends.
 */

import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";
import type { CallOutcome } from "./outcomes";

export async function logCall(
  organizationId: string,
  call: { callerNumber: string | null; startedAt: Date; endedAt: Date; outcomes: CallOutcome[] }
): Promise<void> {
  const phone = normalisePhone(call.callerNumber ?? undefined);
  const lead = phone.ok
    ? await prisma.lead.findUnique({
        where: { organizationId_phone: { organizationId, phone: phone.e164 } },
        select: { id: true },
      })
    : null;
  await prisma.call.create({
    data: {
      organizationId,
      phoneNumber: phone.ok ? phone.e164 : "Withheld",
      status: "completed",
      duration: Math.max(0, Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)),
      outcomes: call.outcomes,
      leadId: lead?.id ?? null,
      createdAt: call.startedAt,
    },
  });
}
