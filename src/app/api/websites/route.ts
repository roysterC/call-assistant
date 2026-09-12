import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireTenant,
  isErrorResponse,
} from "@/lib/tenant";
import {
  buildStarterPrompt,
  slugifySiteId,
  originsFromUrl,
  type SiteProfile,
} from "@/lib/prompt-template";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const sites = await prisma.websiteConfig.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { conversations: true } },
      },
    });
    return NextResponse.json({ sites });
  } catch (error) {
    console.error("[WEBSITES API] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // Any org member can create a site — for their own organisation only.
  // Super-admins may additionally target another org and supply a prompt
  // directly; everyone else gets one generated from structured answers, so
  // the marker contract and guardrails can't be omitted by accident.
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json();
    const {
      siteId: rawSiteId,
      name,
      botName,
      greeting,
      quickReplies,
      brandColor,
      allowedOrigins,
      siteUrl,
      profile,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    const organizationId =
      ctx.isSuperAdmin && body.organizationId
        ? body.organizationId
        : ctx.organizationId;

    // Clients never invent a siteId — it ends up in their embed snippet, where
    // a typo is a support ticket rather than a preference.
    const siteId = (rawSiteId || slugifySiteId(name)).trim();
    if (!/^[a-z0-9-]+$/.test(siteId)) {
      return NextResponse.json(
        { error: "siteId must be lowercase alphanumeric with dashes" },
        { status: 400 }
      );
    }

    let systemPrompt: string;
    if (
      ctx.isSuperAdmin &&
      typeof body.systemPrompt === "string" &&
      body.systemPrompt.trim()
    ) {
      systemPrompt = body.systemPrompt;
    } else if (profile?.businessName && profile?.description) {
      systemPrompt = buildStarterPrompt({
        ...(profile as SiteProfile),
        botName: botName || profile.botName || "Assistant",
      });
    } else {
      return NextResponse.json(
        {
          error:
            "profile.businessName and profile.description are required to generate a prompt",
        },
        { status: 400 }
      );
    }

    // Onboarding is the one moment we reliably know where the widget will
    // live, so origins are captured here rather than left empty — an empty
    // list is currently treated as "any origin".
    const origins =
      allowedOrigins && allowedOrigins.length
        ? allowedOrigins
        : originsFromUrl(siteUrl || "");

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json(
        { error: "organization not found" },
        { status: 404 }
      );
    }

    const site = await prisma.websiteConfig.create({
      data: {
        organizationId,
        siteId,
        name,
        botName: botName || "Assistant",
        systemPrompt,
        greeting: greeting || null,
        quickReplies: quickReplies || [],
        brandColor: brandColor || "#2563eb",
        allowedOrigins: origins,
      },
    });

    return NextResponse.json(site);
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any;
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "siteId already exists" },
        { status: 409 }
      );
    }
    console.error("[WEBSITES API] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
