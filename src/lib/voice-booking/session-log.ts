/**
 * The assistant's conversations, kept for review while it is in testing (the
 * AssistantSession table). Written after every turn rather than at the end:
 * a session is only ever forgotten, after fifteen idle minutes or a restart,
 * never closed, so there is no end to write it at.
 *
 * A failed write is logged and dropped: keeping the transcript must never
 * stop the person at the desk getting their answer.
 */

import { prisma } from "@/lib/prisma";
import { transcriptOf } from "@/lib/receptionist/call-log";
import type { VoiceBookingSession } from "./assistant";

export async function logAssistantSession(session: VoiceBookingSession): Promise<void> {
  const transcript = transcriptOf(session.engine.messages) as unknown as object;
  try {
    await prisma.assistantSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        organizationId: session.asker.organizationId,
        userId: session.userId,
        speaker: session.speaker,
        transcript,
      },
      update: { transcript },
    });
  } catch (err) {
    console.error("[VOICE BOOKING] could not keep the transcript:", err);
  }
}
