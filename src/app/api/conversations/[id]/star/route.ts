import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { isChannelEnabled, type Channel } from "@/lib/channel-flags";

/**
 * Atomic toggle of `starred` on a conversation row, scoped to the tenant.
 *
 * Earlier this endpoint did findUnique → !starred → update. Two concurrent
 * clicks could read the same value, both toggle, and one update would be
 * lost. We now run a single `UPDATE … SET starred = NOT starred …
 * RETURNING starred` so the toggle is atomic at the row-lock level.
 */
async function toggleStarRaw(
  table: "ca_whatsapp_conversations" | "ca_website_conversations" | "ca_social_conversations",
  id: string,
  organizationId: string
): Promise<boolean | null> {
  // Static table name — must use Prisma.raw (we're whitelisting the value
  // via the union type so this is not user-controlled).
  const sql = Prisma.sql`
    UPDATE ${Prisma.raw(`"${table}"`)}
    SET starred = NOT starred
    WHERE id = ${id} AND "organizationId" = ${organizationId}
    RETURNING starred
  `;
  const rows = await prisma.$queryRaw<{ starred: boolean }[]>(sql);
  return rows[0]?.starred ?? null;
}

const TABLE_FOR_CHANNEL: Record<Channel, Parameters<typeof toggleStarRaw>[0]> = {
  whatsapp: "ca_whatsapp_conversations",
  website: "ca_website_conversations",
  instagram: "ca_social_conversations",
  facebook: "ca_social_conversations",
};

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

    if (!(await isChannelEnabled(ctx.organizationId, channel))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const starred = await toggleStarRaw(
      TABLE_FOR_CHANNEL[channel],
      id,
      ctx.organizationId
    );
    if (starred === null) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ id, starred });
  } catch (error) {
    console.error("[STAR API] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
