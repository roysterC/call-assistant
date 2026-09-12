import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireTenant,
  requireSuperAdmin,
  isErrorResponse,
} from "@/lib/tenant";

// Fields any org user (member/admin) can edit
const TENANT_FIELDS = [
  "name",
  "botName",
  "greeting",
  "quickReplies",
  "brandColor",
  "allowedOrigins",
  "enabled",
  "proactiveEnabled",
  "proactiveMessage",
  "proactiveDelaySeconds",
  "proactiveCooldownHours",
  "launcherPosition",
  "launcherOffset",
  "launcherLabel",
  "launcherIcon",
  "theme",
  "fontFamily",
];
// Fields only super-admins can edit
const SUPER_ADMIN_FIELDS = ["systemPrompt"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const site = await prisma.websiteConfig.findUnique({
      where: { id },
      include: {
        _count: { select: { conversations: true } },
      },
    });
    if (!site || site.organizationId !== ctx.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(site);
  } catch (error) {
    console.error("[WEBSITE API] GET error:", error);
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
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;

    // Verify ownership
    const existing = await prisma.websiteConfig.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!existing || existing.organizationId !== ctx.organizationId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();

    const isSuperAdmin = ctx.role === "superAdmin";
    const allowed = isSuperAdmin
      ? [...TENANT_FIELDS, ...SUPER_ADMIN_FIELDS]
      : TENANT_FIELDS;

    const updateData: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updateData[key] = body[key];
    }

    // If the request attempted restricted fields we stripped, tell the client.
    const attemptedRestricted = SUPER_ADMIN_FIELDS.filter((f) => f in body);
    if (!isSuperAdmin && attemptedRestricted.length > 0) {
      // Allow the rest of the update to still apply, but surface the denial.
      if (Object.keys(updateData).length === 0) {
        return NextResponse.json(
          {
            error: `Only super-admins can change: ${attemptedRestricted.join(", ")}`,
          },
          { status: 403 }
        );
      }
    }

    const site = await prisma.websiteConfig.update({
      where: { id },
      data: updateData,
    });
    return NextResponse.json(site);
  } catch (error) {
    console.error("[WEBSITE API] PUT error:", error);
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
  // Only super-admins can delete websites.
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { id } = await params;
    const existing = await prisma.websiteConfig.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.websiteConfig.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[WEBSITE API] DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
