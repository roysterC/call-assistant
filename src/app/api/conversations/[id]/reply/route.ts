import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { isChannelEnabled } from "@/lib/channel-flags";

const MAX_LENGTH = 4000;

/**
 * An operator replies into a website conversation, taking it over from the bot.
 *
 * Website only for now. WhatsApp, Instagram and Facebook replies have to go
 * back out through their own provider APIs rather than simply being written to
 * the transcript, so they are a separate piece of work — this endpoint
 * deliberately refuses them rather than silently storing a message the
 * customer would never receive.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const channel = searchParams.get("channel") || "website";

    if (channel !== "website") {
      return NextResponse.json(
        {
          error:
            "Replies are only supported on website conversations. Other channels must be answered through their own provider.",
        },
        { status: 400 }
      );
    }

    if (!(await isChannelEnabled(ctx.organizationId, "website"))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    if (content.length > MAX_LENGTH) {
      return NextResponse.json({ error: "content too long" }, { status: 400 });
    }

    // Scoped by organizationId as well as id — an id alone must never be
    // enough to write into another tenant's conversation.
    const conversation = await prisma.websiteConversation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [message] = await prisma.$transaction([
      prisma.websiteMessage.create({
        data: { conversationId: conversation.id, role: "agent", content },
      }),
      prisma.websiteConversation.update({
        where: { id: conversation.id },
        data: {
          // Replying is itself the takeover — an operator who types is
          // handling it, whether or not the visitor asked for a person.
          handoffState: "human",
          lastMessageAt: new Date(),
          isRead: true,
        },
      }),
    ]);

    return NextResponse.json({ message });
  } catch (err) {
    console.error("[CONVERSATION REPLY] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
