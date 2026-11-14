import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { parseQuoteItems } from "@/lib/quote-text";

/**
 * Quotes for designs (src/lib/quotes.ts). With ?channel=&conversationId=,
 * the chat's latest quote, waiting or sent, for the panel beside it;
 * without, every quote still waiting for a price, oldest first, for the
 * alert in the corner.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  try {
    const { searchParams } = new URL(req.url);
    const channel = searchParams.get("channel");
    const conversationId = searchParams.get("conversationId");
    const rows = await prisma.quote.findMany({
      where:
        channel && conversationId
          ? { organizationId: ctx.organizationId, channel, conversationId }
          : { organizationId: ctx.organizationId, status: "requested" },
      orderBy: { createdAt: channel && conversationId ? "desc" : "asc" },
      take: channel && conversationId ? 1 : 20,
    });
    const quotes = rows.map((q) => ({
      id: q.id,
      channel: q.channel,
      conversationId: q.conversationId,
      clientName: q.clientName,
      request: q.request,
      items: parseQuoteItems(q.items),
      status: q.status,
      createdAt: q.createdAt.toISOString(),
      sentAt: q.sentAt?.toISOString() ?? null,
      sentBy: q.sentBy,
      sentVia: q.sentVia,
    }));
    return NextResponse.json(channel && conversationId ? { quote: quotes[0] ?? null } : { quotes });
  } catch (error) {
    console.error("[QUOTES API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
