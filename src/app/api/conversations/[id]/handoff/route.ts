import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { isChannelEnabled } from "@/lib/channel-flags";

const STATES = new Set(["bot", "human"]);

/**
 * Operator moves a conversation between the bot and a person.
 *
 * "human" is a takeover without having to type first. "bot" hands it back —
 * without this a conversation that once reached a human stayed there forever,
 * so every routine question after a one-off intervention needed a human too.
 *
 * Website only, matching the reply endpoint: the other channels answer through
 * their own provider APIs and have no bot-suppression path of their own.
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
    if ((searchParams.get("channel") || "website") !== "website") {
      return NextResponse.json(
        { error: "Handoff is only supported on website conversations" },
        { status: 400 }
      );
    }
    if (!(await isChannelEnabled(ctx.organizationId, "website"))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const state = body?.state;
    if (!STATES.has(state)) {
      return NextResponse.json(
        { error: 'state must be "bot" or "human"' },
        { status: 400 }
      );
    }

    // Scoped by organizationId as well as id — an id alone must never be
    // enough to reach another tenant's conversation.
    const conversation = await prisma.websiteConversation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await prisma.websiteConversation.update({
      where: { id: conversation.id },
      data: {
        handoffState: state,
        // Clearing the request timestamp on the way back keeps "how long did
        // someone wait" meaningful rather than measuring from a stale ask.
        handoffRequestedAt: state === "bot" ? null : new Date(),
      },
      select: { handoffState: true },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[CONVERSATION HANDOFF] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
