import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        settings: true,
        users: {
          select: { id: true, email: true, name: true, role: true, createdAt: true },
        },
        phoneNumbers: true,
        _count: { select: { leads: true, calls: true, websites: true } },
      },
    });
    if (!org) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(org);
  } catch (error) {
    console.error("[ADMIN ORG] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const body = await req.json();

    const allowed = ["name", "planTier", "anthropicApiKeyOverride", "enabled"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }
    // A whole-number percentage, or null to hide charges from the salon.
    if ("usageMarkupPercent" in body) {
      const v = body.usageMarkupPercent;
      if (v === null || v === "") {
        data.usageMarkupPercent = null;
      } else {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 10_000) {
          return NextResponse.json(
            { error: "Markup must be a whole-number percentage from 0 to 10,000, or blank." },
            { status: 400 }
          );
        }
        data.usageMarkupPercent = n;
      }
    }

    const org = await prisma.organization.update({
      where: { id },
      data,
    });

    return NextResponse.json(org);
  } catch (error) {
    console.error("[ADMIN ORG] PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    await prisma.organization.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN ORG] DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
