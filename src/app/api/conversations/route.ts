import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { websiteVisitorLabel } from "@/lib/visitor-label";

type NormalizedConversation = {
  id: string;
  channel: "whatsapp" | "website" | "instagram" | "facebook";
  contactName: string | null;
  identifier: string; // phone, siteId+sessionId, IG scoped id, or Messenger PSID
  lastMessage: string | null;
  lastMessageAt: string;
  isRead: boolean;
  starred: boolean;
  status: string;
  createdAt: string;
  messageCount: number;
  lead: {
    id: string;
    name: string | null;
    company: string | null;
  } | null;
  siteName?: string;
  // Social-channel profile data, populated for IG/FB only.
  // Used by the conversation list + contact panel to render avatars
  // and @handles instead of an opaque externalUserId.
  profilePicUrl?: string | null;
  handle?: string | null;
};

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const pageRaw = parseInt(searchParams.get("page") || "1");
    const limitRaw = parseInt(searchParams.get("limit") || "50");
    const filter = searchParams.get("filter");
    const search = searchParams.get("search");
    const channel = searchParams.get("channel") || "all";

    // Honour per-org channel feature flags. A disabled channel returns no
    // rows even if data exists (legacy or pre-disable conversations stay in
    // the DB but become invisible until the channel is re-enabled). Mirrors
    // the sidebar's nav-visibility logic in components/dashboard/sidebar.tsx.
    const settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: {
        whatsappEnabled: true,
        chatbotEnabled: true,
        instagramEnabled: true,
        facebookEnabled: true,
      },
    });
    const enabled = {
      whatsapp: settings?.whatsappEnabled ?? false,
      website: settings?.chatbotEnabled ?? false,
      instagram: settings?.instagramEnabled ?? false,
      facebook: settings?.facebookEnabled ?? false,
    };

    // Clamp untrusted inputs. Max limit 100; max page 500 (hard stop on
    // runaway deep-paging — a tenant hitting page 501 has bigger problems).
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 100);
    const page = Math.min(Math.max(Number.isFinite(pageRaw) ? pageRaw : 1, 1), 500);

    // Window each channel query to `limit * page` rows so the merge-sort
    // across channels remains correct up to the requested page without
    // fetching the entire dataset. Capped at 1000 per channel.
    const perChannelTake = Math.min(limit * page, 1000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseWhere: any = { organizationId: ctx.organizationId };
    if (filter === "unread") baseWhere.isRead = false;
    else if (filter === "starred") baseWhere.starred = true;
    else if (filter === "recent") {
      baseWhere.lastMessageAt = {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      };
    }

    const results: NormalizedConversation[] = [];
    let waTotal = 0;
    let webTotal = 0;
    let socialTotal = 0;

    // WhatsApp conversations
    if (enabled.whatsapp && (channel === "all" || channel === "whatsapp")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const waWhere: any = { ...baseWhere };
      if (search) {
        waWhere.OR = [
          { contactName: { contains: search, mode: "insensitive" } },
          { phoneNumber: { contains: search } },
          { lead: { name: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [waConvs, waCount] = await Promise.all([
        prisma.whatsAppConversation.findMany({
          where: waWhere,
          include: {
            lead: { select: { id: true, name: true, company: true } },
            _count: { select: { messages: true } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { content: true },
            },
          },
          orderBy: { lastMessageAt: "desc" },
          take: perChannelTake,
        }),
        prisma.whatsAppConversation.count({ where: waWhere }),
      ]);
      waTotal = waCount;

      for (const c of waConvs) {
        results.push({
          id: c.id,
          channel: "whatsapp",
          contactName: c.contactName || c.lead?.name || null,
          identifier: c.phoneNumber,
          lastMessage: c.messages[0]?.content || null,
          lastMessageAt: c.lastMessageAt.toISOString(),
          isRead: c.isRead,
          starred: c.starred,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
          messageCount: c._count.messages,
          lead: c.lead,
        });
      }
    }

    // Website conversations
    if (enabled.website && (channel === "all" || channel === "website")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webWhere: any = { ...baseWhere };
      if (search) {
        webWhere.OR = [
          { visitorName: { contains: search, mode: "insensitive" } },
          { visitorEmail: { contains: search, mode: "insensitive" } },
          { lead: { name: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [webConvs, webCount] = await Promise.all([
        prisma.websiteConversation.findMany({
          where: webWhere,
          include: {
            lead: { select: { id: true, name: true, company: true } },
            site: { select: { name: true, siteId: true } },
            _count: { select: { messages: true } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { content: true },
            },
          },
          orderBy: { lastMessageAt: "desc" },
          take: perChannelTake,
        }),
        prisma.websiteConversation.count({ where: webWhere }),
      ]);
      webTotal = webCount;

      for (const c of webConvs) {
        results.push({
          id: c.id,
          channel: "website",
          contactName: c.visitorName || c.lead?.name || null,
          identifier: c.visitorEmail || websiteVisitorLabel(c.sessionId),
          lastMessage: c.messages[0]?.content || null,
          lastMessageAt: c.lastMessageAt.toISOString(),
          isRead: c.isRead,
          starred: c.starred,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
          messageCount: c._count.messages,
          lead: c.lead,
          siteName: c.site.name,
        });
      }
    }

    // Social conversations (Instagram + Facebook Messenger)
    const wantInstagram =
      enabled.instagram && (channel === "all" || channel === "instagram");
    const wantFacebook =
      enabled.facebook && (channel === "all" || channel === "facebook");
    if (wantInstagram || wantFacebook) {
      const channelFilter =
        wantInstagram && wantFacebook
          ? { in: ["instagram", "facebook"] as string[] }
          : wantInstagram
          ? "instagram"
          : "facebook";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const socialWhere: any = { ...baseWhere, channel: channelFilter };
      if (search) {
        socialWhere.OR = [
          { contactName: { contains: search, mode: "insensitive" } },
          { externalUserId: { contains: search } },
          { lead: { name: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [socialConvs, socialCount] = await Promise.all([
        prisma.socialConversation.findMany({
          where: socialWhere,
          include: {
            lead: { select: { id: true, name: true, company: true } },
            _count: { select: { messages: true } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { content: true },
            },
          },
          orderBy: { lastMessageAt: "desc" },
          take: perChannelTake,
        }),
        prisma.socialConversation.count({ where: socialWhere }),
      ]);
      socialTotal = socialCount;

      for (const c of socialConvs) {
        results.push({
          id: c.id,
          channel: c.channel as "instagram" | "facebook",
          contactName: c.contactName || c.lead?.name || null,
          // Don't surface the Meta-internal sender id as the row's
          // identifier — it looks like a 16-digit "phone number" in the
          // UI. The handle is already on its own field and the
          // list-item component falls back through contactName → handle
          // → channel-specific placeholder.
          identifier: "",
          lastMessage: c.messages[0]?.content || null,
          lastMessageAt: c.lastMessageAt.toISOString(),
          isRead: c.isRead,
          starred: c.starred,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
          messageCount: c._count.messages,
          lead: c.lead,
          profilePicUrl: c.profilePicUrl,
          handle: c.contactHandle,
        });
      }
    }

    // Sort merged results by lastMessageAt desc
    results.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime()
    );

    const total = waTotal + webTotal + socialTotal;
    const start = (page - 1) * limit;
    const conversations = results.slice(start, start + limit);

    return NextResponse.json({
      conversations,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("[CONVERSATIONS API] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
