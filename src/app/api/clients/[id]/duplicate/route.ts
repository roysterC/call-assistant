/**
 * A client card that may be someone already on file (src/lib/client-merge.ts).
 *
 *   POST   { into: "<client id>" }  this card is that client: everything on
 *                                   it moves there, and this card goes.
 *   DELETE                          not the same person: the mark comes off.
 *
 * For the salon's staff as well as the owner: sorting out duplicates is
 * day-to-day work, and a merge loses nothing (unlike deleting a client,
 * which is the owner's).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { mergeClients, notADuplicate } from "@/lib/client-merge";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { into?: unknown } | null;
    if (typeof body?.into !== "string" || !body.into) {
      return NextResponse.json({ error: "Which client is this the same person as?" }, { status: 400 });
    }
    const result = await mergeClients(ctx.organizationId, id, body.into);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
    return NextResponse.json({ merged: true, into: result.into, moved: result.moved });
  } catch (error) {
    console.error("[CLIENTS API] merge error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    if (!(await notADuplicate(ctx.organizationId, id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ cleared: true });
  } catch (error) {
    console.error("[CLIENTS API] not-a-duplicate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
