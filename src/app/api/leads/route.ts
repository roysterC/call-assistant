import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { parsePagination } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const { take, skip } = parsePagination(searchParams);

    const where: Record<string, unknown> = { organizationId: ctx.organizationId };
    if (status) where.status = status;

    const [rawLeads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          _count: { select: { calls: true, callbacks: true } },
          // A client reached through someone else's number has none of their own.
          contactLead: { select: { name: true, phone: true } },
          // Pull just the most-recent social/whatsapp conversation so the
          // list page can render the right contact identifier (handle,
          // avatar, profile-derived name) without an N+1 round trip.
          socialConversations: {
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: {
              channel: true,
              externalUserId: true,
              contactName: true,
              contactHandle: true,
              profilePicUrl: true,
            },
          },
          whatsappConversations: {
            orderBy: { lastMessageAt: "desc" },
            take: 1,
            select: {
              waId: true,
              contactName: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.lead.count({ where }),
    ]);

    // Flatten the per-channel join into a single optional `socialContact`
    // and `whatsappContact` field so the UI doesn't have to peek into the
    // conversation arrays. Drops the original arrays from the response to
    // keep the payload tight.
    const leads = rawLeads.map((l) => {
      const social = l.socialConversations[0] ?? null;
      const wa = l.whatsappConversations[0] ?? null;
      const { socialConversations, whatsappConversations, ...rest } = l;
      void socialConversations;
      void whatsappConversations;
      return {
        ...rest,
        socialContact: social
          ? {
              channel: social.channel,
              externalUserId: social.externalUserId,
              contactName: social.contactName,
              handle: social.contactHandle,
              profilePicUrl: social.profilePicUrl,
            }
          : null,
        whatsappContact: wa
          ? { waId: wa.waId, contactName: wa.contactName }
          : null,
      };
    });

    return NextResponse.json({ leads, total, limit: take, offset: skip });
  } catch (error) {
    console.error("[LEADS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
