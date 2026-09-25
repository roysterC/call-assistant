import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "pending";

    const callbacks = await prisma.callback.findMany({
      where: { status, organizationId: ctx.organizationId },
      include: { lead: true },
      orderBy: { scheduledAt: "asc" },
    });

    return NextResponse.json({ callbacks });
  } catch (error) {
    console.error("[CALLBACKS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const VALID_OUTCOMES = [
  "converted",
  "no_answer",
  "not_interested",
  "follow_up",
  "other",
];

export async function PATCH(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json();
    const { id, status, outcome, notes, completedAt } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (outcome !== undefined && outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${VALID_OUTCOMES.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify ownership
    const existing = await prisma.callback.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data: Prisma.CallbackUncheckedUpdateInput = {};
    if (status !== undefined) data.status = status;
    if (outcome !== undefined) data.outcome = outcome;
    if (notes !== undefined) data.notes = notes;
    if (completedAt !== undefined) {
      data.completedAt = completedAt === null ? null : new Date(completedAt);
    }
    // Auto-stamp completedAt when transitioning to "completed" without one supplied
    if (status === "completed" && completedAt === undefined) {
      data.completedAt = new Date();
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "at least one of status, outcome, notes, completedAt is required" },
        { status: 400 }
      );
    }

    const callback = await prisma.callback.update({
      where: { id },
      data,
    });

    return NextResponse.json({ callback });
  } catch (error) {
    console.error("[CALLBACKS API] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
