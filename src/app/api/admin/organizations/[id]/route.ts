import { businessTypesOf } from "@/lib/business-types";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { smsConfigured } from "@/lib/sms";

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
          select: { id: true, email: true, name: true, role: true, createdAt: true, emailVerified: true },
        },
        phoneNumbers: true,
        _count: { select: { leads: true, calls: true, websites: true } },
      },
    });
    if (!org) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // What the page needs to say whether the salon's texts can go, as its
    // sender is typed (src/lib/sms-sender.ts).
    return NextResponse.json({
      ...org,
      textSending: { configured: smsConfigured(), defaultSender: process.env.TWILIO_DEFAULT_SENDER || null },
    });
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

    // The business type and what else it offers, validated together: an
    // unknown type reads as hair, the main type never also in alsoOffers.
    if ("businessType" in body || "alsoOffers" in body) {
      const current = await prisma.organization.findUnique({
        where: { id },
        select: { businessType: true, alsoOffers: true },
      });
      const types = businessTypesOf(
        "businessType" in body ? body.businessType : current?.businessType,
        "alsoOffers" in body ? body.alsoOffers : current?.alsoOffers
      );
      data.businessType = types[0];
      data.alsoOffers = types.slice(1);
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
    // Its logins go with it (their sign-ins and devices with them): kept, they
    // belonged to no salon and their addresses could never be invited again.
    // Kikai's own super-admin logins are only detached.
    await prisma.$transaction([
      prisma.user.deleteMany({ where: { organizationId: id, role: { not: "superAdmin" } } }),
      prisma.organization.delete({ where: { id } }),
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ADMIN ORG] DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
