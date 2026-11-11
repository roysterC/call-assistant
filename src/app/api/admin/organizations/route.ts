import { businessTypesOf, starterServices } from "@/lib/business-types";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, isErrorResponse } from "@/lib/tenant";
import { createInvitation, emailInvitation, normaliseEmail } from "@/lib/invitations";
import { emailAvailable } from "@/lib/email";
import { linkOrigin } from "@/lib/app-origin";

export async function GET() {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            users: true,
            leads: true,
            calls: true,
            phoneNumbers: true,
            websites: true,
          },
        },
      },
    });
    return NextResponse.json({ organizations: orgs });
  } catch (error) {
    console.error("[ADMIN ORGS] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireSuperAdmin();
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json();
    const { name, slug, planTier } = body;
    // Main type first; hair when not given (business-types.ts).
    const types = businessTypesOf(body.businessType, body.alsoOffers);

    if (!name || !slug) {
      return NextResponse.json(
        { error: "name and slug are required" },
        { status: 400 }
      );
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json(
        { error: "slug must be lowercase alphanumeric with dashes" },
        { status: 400 }
      );
    }

    // With an owner's email, the salon is made ready for them to set up
    // themselves: they get an invite link and land on onboarding. Checked
    // before the salon is made, so a bad address leaves nothing behind.
    const ownerEmail = body.ownerEmail ? normaliseEmail(body.ownerEmail) : null;
    if (body.ownerEmail && !ownerEmail) {
      return NextResponse.json({ error: "The owner's email address does not look right." }, { status: 400 });
    }
    if (ownerEmail && (await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } }))) {
      return NextResponse.json(
        { error: "The owner's email already has a login. Use a different address." },
        { status: 409 }
      );
    }

    const org = await prisma.organization.create({
      data: {
        name,
        needsOnboarding: Boolean(ownerEmail),
        slug,
        planTier: planTier || "starter",
        businessType: types[0],
        alsoOffers: types.slice(1),
        settings: {
          create: {
            businessName: name,
            // A starting price list for its trades, unpriced: the salon
            // edits it in Settings before the receptionist goes live.
            services: starterServices(types) as unknown as Prisma.InputJsonValue,
          },
        },
      },
      include: { settings: true },
    });

    if (ownerEmail) {
      const base = { organizationId: org.id, email: ownerEmail, role: "admin", createdById: ctx.userId };
      // Emailed where email is set up, unless asked for a link to copy.
      if ((body.ownerDelivery ?? (emailAvailable() ? "email" : "link")) === "email") {
        const sent = await emailInvitation({ ...base, origin: linkOrigin(req.nextUrl.origin) });
        if (sent.ok) return NextResponse.json({ ...org, invitation: sent.invitation, inviteEmailed: true });
        return NextResponse.json({ ...org, inviteError: sent.error });
      }
      const invite = await createInvitation(base);
      if (invite.ok) return NextResponse.json({ ...org, invitation: invite.invitation, inviteToken: invite.token });
      // The salon is made; the invite can be sent again from its page.
      return NextResponse.json({ ...org, inviteError: invite.error });
    }
    return NextResponse.json(org);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;
    if (err.code === "P2002") {
      return NextResponse.json({ error: "slug already exists" }, { status: 409 });
    }
    console.error("[ADMIN ORGS] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
