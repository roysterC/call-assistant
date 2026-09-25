/**
 * Blocked time in the diary: list it for a range, add it.
 *
 * The owner blocks anyone's time, or everyone's. A stylist login blocks only
 * their own, and sees a colleague's blocks as "Unavailable": why someone is
 * off is theirs to share.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canWriteColumn,
  isStylist,
  notYourColumn,
  requireTenant,
  isErrorResponse,
} from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { matchStylist } from "@/lib/salon-config";
import { expandBlocks, parseTimeBlockForm } from "@/lib/time-blocks";
import { bookingsInBlock } from "@/lib/time-block-store";

const MAX_RANGE_DAYS = 62;

/** Every stretch of blocked time in [from, to), with the blocks they come from. */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { stylists: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const from = new Date(searchParams.get("from") ?? "");
    const to = new Date(searchParams.get("to") ?? "");
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return NextResponse.json({ error: "from and to must be dates, from first" }, { status: 400 });
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      return NextResponse.json({ error: "That range is too long." }, { status: 400 });
    }

    const cfg = await getSalonConfig(ctx.organizationId);
    const rows = await prisma.timeBlock.findMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [{ repeat: "weekly" }, { startsAt: { lt: to }, endsAt: { gt: from } }],
      },
    });
    let occurrences = expandBlocks(rows, from, to, cfg.timeZone);
    let records = rows;
    if (ctx.stylist) {
      const mine = (name: string | null) => name !== null && isStylist(ctx, name);
      if (ctx.stylist.diaryScope === "own") {
        occurrences = occurrences.filter((o) => o.stylistName === null || mine(o.stylistName));
      }
      occurrences = occurrences.map((o) =>
        o.stylistName === null || mine(o.stylistName) ? o : { ...o, label: "Unavailable" }
      );
      // Only their own blocks can be opened for editing.
      records = rows.filter((r) => mine(r.stylistName));
    }
    const used = new Set(occurrences.map((o) => o.blockId));

    return NextResponse.json({
      occurrences,
      blocks: records.filter((r) => used.has(r.id)),
    });
  } catch (error) {
    console.error("[TIME BLOCKS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Add a block. With `preview: true`, save nothing and return the upcoming
 * bookings that fall inside it, so the form can show them first.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { stylists: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const cfg = await getSalonConfig(ctx.organizationId);

    const parsed = parseTimeBlockForm(body, cfg.timeZone);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const data = parsed.data;

    if (data.stylistName) {
      const stylist = matchStylist(data.stylistName, cfg.stylists);
      if (!stylist) {
        return NextResponse.json(
          { error: `No stylist called "${data.stylistName}".` },
          { status: 400 }
        );
      }
      data.stylistName = stylist.name;
    }
    // A stylist blocks their own time, never the whole salon's.
    if (ctx.stylist && (data.stylistName === null || !canWriteColumn(ctx, data.stylistName))) {
      return notYourColumn();
    }

    const affected = await bookingsInBlock(ctx.organizationId, data, cfg.timeZone);
    if (body?.preview === true) return NextResponse.json({ affected });

    const block = await prisma.timeBlock.create({
      data: { ...data, organizationId: ctx.organizationId },
    });
    return NextResponse.json({ block, affected }, { status: 201 });
  } catch (error) {
    console.error("[TIME BLOCKS API] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
