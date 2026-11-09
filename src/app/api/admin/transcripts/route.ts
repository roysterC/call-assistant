/**
 * The receptionist's phone call transcripts, newest first, for super-admins:
 * kept for training while it is in testing (receptionist/call-log.ts).
 *
 *   GET /api/admin/transcripts                 the last 20, readable text
 *   GET /api/admin/transcripts?limit=50
 *   GET /api/admin/transcripts?format=json     with each tool's full input and result
 *   GET /api/admin/transcripts?kind=assistant  the personal assistant's sessions instead
 *
 * The text form is meant to be read, or pasted into a conversation about how
 * a call went: who said what, and each tool used with its reply.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import type { TranscriptLine } from "@/lib/receptionist/call-log";
import { assistantTranscriptText, transcriptText } from "@/lib/receptionist/transcript-text";

export async function GET(req: NextRequest) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  const params = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 20));
  if (params.get("kind") === "assistant") {
    const sessions = await prisma.assistantSession.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        speaker: true,
        transcript: true,
        organization: { select: { name: true } },
      },
    });
    if (params.get("format") === "json") return NextResponse.json({ sessions });
    const text = sessions
      .map((s) =>
        assistantTranscriptText({
          id: s.id,
          salon: s.organization.name,
          at: s.createdAt,
          speaker: s.speaker,
          lines: s.transcript as unknown as TranscriptLine[],
        })
      )
      .join("\n\n");
    return plain(text || "No assistant sessions yet.\n");
  }

  const calls = await prisma.call.findMany({
    where: { vapiCallId: null, transcript: { not: { equals: null } } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      phoneNumber: true,
      duration: true,
      outcomes: true,
      transcript: true,
      organization: { select: { name: true } },
    },
  });

  if (params.get("format") === "json") return NextResponse.json({ calls });

  const text = calls
    .map((c) =>
      transcriptText({
        id: c.id,
        salon: c.organization.name,
        at: c.createdAt,
        phoneNumber: c.phoneNumber,
        duration: c.duration,
        outcomes: c.outcomes,
        lines: (c.transcript ?? []) as unknown as TranscriptLine[],
      })
    )
    .join("\n\n");
  return plain(text || "No transcripts yet.\n");
}

function plain(text: string): NextResponse {
  return new NextResponse(text, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
