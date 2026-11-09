/**
 * A photo a client sent by message (chat-photos.ts), for the salon's team:
 * shown with the booking it came with.
 *
 *   GET → the image itself
 *
 * Anyone at the salon, as for the diary; only this salon's photos.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const { id } = await params;
  const photo = await prisma.chatPhoto.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { mediaType: true, data: true },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(photo.data), {
    headers: {
      "content-type": photo.mediaType.startsWith("image/") ? photo.mediaType : "application/octet-stream",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
