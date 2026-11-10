import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * The "Stop these texts" button on /r/<id>/stop: a plain form post, so it
 * works on any phone, then back to that page, which now says it is done.
 * Public (proxy.ts); the unguessable id in the link is the permission.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const id = String(form?.get("id") ?? "");
  const text = id
    ? await prisma.rebookText.findUnique({ where: { id }, select: { leadId: true, stoppedAt: true } })
    : null;
  if (!text) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.lead.update({ where: { id: text.leadId }, data: { rebookTextsOff: true } }),
    ...(text.stoppedAt ? [] : [prisma.rebookText.update({ where: { id }, data: { stoppedAt: new Date() } })]),
  ]);
  // Relative, so it lands on whatever address the client came in on.
  return new NextResponse(null, { status: 303, headers: { Location: `/r/${encodeURIComponent(id)}/stop` } });
}
