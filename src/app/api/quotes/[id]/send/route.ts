import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { sendQuote } from "@/lib/quotes";

/**
 * Answer a quote: a price (and optionally a time) for each design, or "not
 * one we do". The reply goes back in the client's chat, signed with the
 * first name of whoever sent it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    const name = user?.name?.trim() || null;
    const result = await sendQuote({
      organizationId: ctx.organizationId,
      quoteId: id,
      items: body?.items,
      from: name ? name.trim().split(/\s+/)[0] : null,
      sentBy: name,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ sent: true, via: result.via, text: result.text });
  } catch (error) {
    console.error("[QUOTES API] send error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
