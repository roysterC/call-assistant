import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { isChannelEnabled, type Channel } from "@/lib/channel-flags";
import { websiteVisitorLabel } from "@/lib/visitor-label";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireTenant(req);
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

    // Match the list endpoint's flag gating — disabled channels 404 even on
    // direct-link / deep-link access.
    if (!(await isChannelEnabled(ctx.organizationId, channel))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (channel === "website") {
      const conv = await prisma.websiteConversation.findUnique({
        where: { id },
        include: {
          lead: true,
          site: { select: { name: true, siteId: true, botName: true } },
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!conv || conv.organizationId !== ctx.organizationId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({
        id: conv.id,
        channel: "website",
        // Falls back to the same label the list shows, so a conversation does
        // not change its name when you click into it.
        contactName:
          conv.visitorName ||
          conv.lead?.name ||
          conv.visitorEmail ||
          websiteVisitorLabel(conv.sessionId),
        phoneNumber: conv.visitorPhone || "",
        visitorEmail: conv.visitorEmail,
        visitorPhone: conv.visitorPhone,
        status: conv.status,
        isRead: conv.isRead,
        starred: conv.starred,
        createdAt: conv.createdAt,
        lastMessageAt: conv.lastMessageAt,
        personaResetAt: conv.personaResetAt,
        // Without this the inbox could never tell which side was handling the
        // conversation: the status line and the take-over/hand-back button
        // both read it, and it was being dropped by this normalisation.
        handoffState: conv.handoffState,
        userAgent: conv.userAgent,
        referrer: conv.referrer,
        site: conv.site,
        lead: conv.lead,
        messages: conv.messages,
      });
    }

    if (channel === "instagram" || channel === "facebook") {
      const conv = await prisma.socialConversation.findUnique({
        where: { id },
        include: {
          lead: true,
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!conv || conv.organizationId !== ctx.organizationId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      return NextResponse.json({
        id: conv.id,
        channel: conv.channel,
        contactName: conv.contactName,
        // IG/FB don't have a phone number — externalUserId is a Meta-
        // internal sender id, not a phone, and surfacing it caused the
        // UI to render strings like "4399588490370035" under the
        // contact name. Frontend falls back to @handle / channel
        // placeholder when this is empty.
        phoneNumber: "",
        status: conv.status,
        isRead: conv.isRead,
        starred: conv.starred,
        createdAt: conv.createdAt,
        lastMessageAt: conv.lastMessageAt,
        personaResetAt: conv.personaResetAt,
        lead: conv.lead,
        messages: conv.messages,
        profilePicUrl: conv.profilePicUrl,
        handle: conv.contactHandle,
      });
    }

    const conversation = await prisma.whatsAppConversation.findUnique({
      where: { id },
      include: {
        lead: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation || conversation.organizationId !== ctx.organizationId) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Hand-pick fields to match the canonical shape used by the website
    // and social branches. Earlier we spread `...conversation` which leaked
    // internal columns (waId, organizationId, raw timestamps, etc.) and
    // diverged from the other branches' shapes.
    return NextResponse.json({
      id: conversation.id,
      channel: "whatsapp",
      contactName: conversation.contactName,
      phoneNumber: conversation.phoneNumber,
      status: conversation.status,
      isRead: conversation.isRead,
      starred: conversation.starred,
      createdAt: conversation.createdAt,
      lastMessageAt: conversation.lastMessageAt,
      personaResetAt: conversation.personaResetAt,
      lead: conversation.lead,
      messages: conversation.messages,
    });
  } catch (error) {
    console.error("[CONVERSATION API] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
