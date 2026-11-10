import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { businessTypesOf, PROFILES } from "@/lib/business-types";
import { parseServices } from "@/lib/salon-config";
import { bookingReadiness, missingText } from "@/lib/booking/readiness";
import { servicesAfterTypeChange } from "@/lib/onboarding";

/**
 * A salon's owner setting it up (src/app/onboarding). Hours, services and
 * team are saved through /api/settings like anywhere else; this is for what
 * only onboarding does: naming the salon and choosing its type, which Kikai
 * otherwise sets, and finishing.
 */

async function readOrg(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, businessType: true, alsoOffers: true, needsOnboarding: true },
  });
}

/** Where the salon stands, for the page: staff see it is being set up. */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const org = await readOrg(ctx.organizationId);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  const types = businessTypesOf(org.businessType, org.alsoOffers);
  return NextResponse.json({
    needsOnboarding: org.needsOnboarding,
    isOwner: ctx.role !== "member",
    name: org.name,
    businessType: types[0],
    alsoOffers: types.slice(1),
    staff: PROFILES[types[0]].staff,
  });
}

/**
 * { name?, businessType?, alsoOffers? }, only while onboarding. A new type
 * swaps the starter price list for the new type's, unless the owner has
 * already made it their own.
 */
export async function PUT(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const org = await readOrg(ctx.organizationId);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  if (!org.needsOnboarding) {
    return NextResponse.json({ error: "Your salon is already set up. Change it in Settings." }, { status: 409 });
  }

  const orgData: Prisma.OrganizationUpdateInput = {};
  const settingsData: Prisma.OrganizationSettingsUpdateInput = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: "Enter your salon's name." }, { status: 400 });
    orgData.name = name;
    settingsData.businessName = name;
  }

  let services: unknown;
  if (body.businessType !== undefined || body.alsoOffers !== undefined) {
    const from = businessTypesOf(org.businessType, org.alsoOffers);
    const to = businessTypesOf(body.businessType ?? org.businessType, body.alsoOffers ?? org.alsoOffers);
    orgData.businessType = to[0];
    orgData.alsoOffers = to.slice(1);
    const current = await prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { services: true },
    });
    const next = servicesAfterTypeChange(parseServices(current?.services), from, to);
    if (next) settingsData.services = next as unknown as Prisma.InputJsonValue;
    services = next ?? undefined;
  }

  await prisma.$transaction([
    prisma.organization.update({ where: { id: ctx.organizationId }, data: orgData }),
    ...(Object.keys(settingsData).length
      ? [prisma.organizationSettings.update({ where: { organizationId: ctx.organizationId }, data: settingsData })]
      : []),
  ]);
  const types = businessTypesOf(orgData.businessType ?? org.businessType, orgData.alsoOffers ?? org.alsoOffers);
  return NextResponse.json({ ok: true, staff: PROFILES[types[0]].staff, ...(services ? { services } : {}) });
}

/** Finish: refused while the diary could not take a booking. */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;
  const [org, settings] = await Promise.all([
    readOrg(ctx.organizationId),
    prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { services: true, teamMembers: true, businessHours: true, diaryProvider: true },
    }),
  ]);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  const staff = PROFILES[businessTypesOf(org.businessType)[0]].staff;
  const readiness = bookingReadiness({
    services: settings?.services,
    teamMembers: settings?.teamMembers,
    businessHours: settings?.businessHours,
    diaryProvider: settings?.diaryProvider,
    staff,
  });
  if (!readiness.ready) {
    return NextResponse.json(
      { error: `Your diary can't take bookings yet: ${missingText(readiness)}.`, missing: readiness.missing },
      { status: 409 }
    );
  }
  await prisma.organization.update({ where: { id: ctx.organizationId }, data: { needsOnboarding: false } });
  return NextResponse.json({ ok: true });
}
