/**
 * One block: change it, take a single week out of it, or remove it.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { getSalonConfig } from "@/lib/booking";
import { matchStylist } from "@/lib/salon-config";
import { parseTimeBlockForm } from "@/lib/time-blocks";
import { bookingsInBlock } from "@/lib/time-block-store";

type Params = { params: Promise<{ id: string }> };

async function findOwn(id: string, organizationId: string) {
  return prisma.timeBlock.findFirst({ where: { id, organizationId } });
}

/**
 * `{ skipDate: "YYYY-MM-DD" }` takes that week out of a weekly block.
 * Anything else is the whole form again, as on create (with `preview`).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const existing = await findOwn(id, ctx.organizationId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));

    if (typeof body?.skipDate === "string") {
      if (existing.repeat !== "weekly" || !/^\d{4}-\d{2}-\d{2}$/.test(body.skipDate)) {
        return NextResponse.json(
          { error: "Only a week of a repeating block can be skipped." },
          { status: 400 }
        );
      }
      const block = await prisma.timeBlock.update({
        where: { id },
        data: { skipDates: [...new Set([...existing.skipDates, body.skipDate])].sort() },
      });
      return NextResponse.json({ block });
    }

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
    // Weeks already skipped stay skipped while the rule is the same shape.
    if (existing.repeat === "weekly" && data.repeat === "weekly") {
      data.skipDates = existing.skipDates;
    }

    const affected = await bookingsInBlock(ctx.organizationId, data, cfg.timeZone);
    if (body?.preview === true) return NextResponse.json({ affected });

    const block = await prisma.timeBlock.update({ where: { id }, data });
    return NextResponse.json({ block, affected });
  } catch (error) {
    console.error("[TIME BLOCKS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const existing = await findOwn(id, ctx.organizationId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await prisma.timeBlock.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[TIME BLOCKS API] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
