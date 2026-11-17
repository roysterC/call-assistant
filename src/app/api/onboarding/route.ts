import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse, after } from "next/server";
import { notifyKikai } from "@/lib/notify";
import { linkOrigin } from "@/lib/app-origin";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { PROFILES } from "@/lib/business-types";
import { bookingReadiness, missingText } from "@/lib/booking/readiness";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/onboarding";

/**
 * A salon's owner setting it up (src/app/onboarding). Hours, services and
 * team are saved through /api/settings like anywhere else; this is for what
 * only onboarding does: naming the salon, and finishing.
 */

async function readOrg(organizationId: string) {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, needsOnboarding: true, onboardingStep: true },
  });
}

/** Where the salon stands, for the page: staff see it is being set up. */
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;
  const org = await readOrg(ctx.organizationId);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  const [user, settings] = await Promise.all([
    ctx.userId === "dev-user" ? null : prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
    prisma.organizationSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { voiceEnabled: true } }),
  ]);
  return NextResponse.json({
    needsOnboarding: org.needsOnboarding,
    isOwner: ctx.role !== "member",
    /** Theirs, to offer adding themselves to the team. */
    ownerName: user?.name ?? null,
    /** The last step they reached, to come back to. */
    step: org.onboardingStep,
    /** Whether the phone receptionist is already on, for "what's next". */
    voiceEnabled: Boolean(settings?.voiceEnabled),
    name: org.name,
    staff: PROFILES.nails.staff,
  });
}

/** { name?, reached? }, only while onboarding. */
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

  // Where they have got to, for Kikai to see in Admin and for coming back.
  if (body.reached !== undefined) {
    if (!ONBOARDING_STEPS.includes(body.reached as OnboardingStep)) {
      return NextResponse.json({ error: "Unknown step." }, { status: 400 });
    }
    orgData.onboardingStep = body.reached as string;
  }

  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: "Enter your salon's name." }, { status: 400 });
    orgData.name = name;
    settingsData.businessName = name;
  }

  await prisma.$transaction([
    prisma.organization.update({ where: { id: ctx.organizationId }, data: orgData }),
    ...(Object.keys(settingsData).length
      ? [prisma.organizationSettings.update({ where: { organizationId: ctx.organizationId }, data: settingsData })]
      : []),
  ]);
  return NextResponse.json({ ok: true });
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
  const staff = PROFILES.nails.staff;
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
  await prisma.organization.update({
    where: { id: ctx.organizationId },
    data: { needsOnboarding: false, onboardingStep: "done" },
  });
  if (org.needsOnboarding && !ctx.isSuperAdmin) {
    const origin = linkOrigin(req.nextUrl.origin);
    const counts = {
      services: Array.isArray(settings?.services) ? settings.services.length : 0,
      team: Array.isArray(settings?.teamMembers) ? settings.teamMembers.length : 0,
    };
    after(() =>
      notifyKikai({
        subject: `${org.name} finished setting up`,
        lines: [
          `The owner of ${org.name} finished onboarding: ${counts.services} services and ${counts.team} on the team, and the diary can take bookings.`,
          "Next from you: their phone line and receptionist, if they're having them.",
        ],
        button: "Open the salon in Admin",
        url: `${origin}/admin/organizations/${ctx.organizationId}`,
      })
    );
  }
  return NextResponse.json({ ok: true });
}
