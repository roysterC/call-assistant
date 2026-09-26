/**
 * Change how a client is reached, at the desk.
 *
 * A client reached through someone else's number (a child booked on a
 * parent's phone) can be given a number of their own, after which their
 * texts go to it; and, once they have one, unlinked from the parent's, so a
 * call from that number no longer manages their bookings. Unlinking a client
 * with no number of their own is refused: nobody could then text them or
 * find their bookings by phone.
 *
 * Owner only: stylists add and book clients but do not rewire them.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { normalisePhone } from "@/lib/phone";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) ?? {};

    const client = await prisma.lead.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, phone: true, contactLeadId: true },
    });
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: { phone?: string; contactLeadId?: null } = {};

    if (typeof body.phone === "string" && body.phone.trim()) {
      const parsed = normalisePhone(body.phone);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: `That number does not look right: ${parsed.reason}` },
          { status: 400 }
        );
      }
      const taken = await prisma.lead.findFirst({
        where: { organizationId: ctx.organizationId, phone: parsed.e164, id: { not: id } },
        select: { name: true },
      });
      if (taken) {
        return NextResponse.json(
          { error: `${taken.name ?? "Another client"} already has that number.` },
          { status: 409 }
        );
      }
      data.phone = parsed.e164;
    }

    if (body.unlink === true && client.contactLeadId) {
      if (!(data.phone ?? client.phone)) {
        return NextResponse.json(
          { error: "Give them a number of their own before unlinking, or nobody can text them." },
          { status: 400 }
        );
      }
      data.contactLeadId = null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const updated = await prisma.lead.update({
      where: { id },
      data,
      select: {
        id: true,
        phone: true,
        contactLead: { select: { id: true, name: true, phone: true } },
      },
    });
    return NextResponse.json({ client: updated });
  } catch (error) {
    console.error("[CLIENTS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
