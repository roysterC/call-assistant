import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { isChannelEnabled, type Channel } from "@/lib/channel-flags";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const channelRaw = searchParams.get("channel") || "whatsapp";
    if (
      channelRaw !== "whatsapp" &&
      channelRaw !== "website" &&
      channelRaw !== "instagram" &&
      channelRaw !== "facebook"
    ) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }
    const channel = channelRaw as Channel;

    // Honour per-org feature flags. The list endpoint hides disabled-channel
    // rows; the mutation endpoints used to allow direct-URL bypass. Now they
    // 404 like any unknown row would.
    if (!(await isChannelEnabled(ctx.organizationId, channel))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // updateMany with a tenant-scoped where clause is atomic + tenant-safe in
    // a single statement. count===0 distinguishes "not yours" or "not found"
    // from a real DB error.
    let count = 0;
    if (channel === "website") {
      const r = await prisma.websiteConversation.updateMany({
        where: { id, organizationId: ctx.organizationId },
        data: { isRead: true },
      });
      count = r.count;
    } else if (channel === "instagram" || channel === "facebook") {
      const r = await prisma.socialConversation.updateMany({
        where: { id, organizationId: ctx.organizationId },
        data: { isRead: true },
      });
      count = r.count;
    } else {
      const r = await prisma.whatsAppConversation.updateMany({
        where: { id, organizationId: ctx.organizationId },
        data: { isRead: true },
      });
      count = r.count;
    }

    if (count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ id, isRead: true });
  } catch (error) {
    console.error("[READ API] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
