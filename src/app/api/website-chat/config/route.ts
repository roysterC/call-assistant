import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { corsHeaders } from "@/lib/website-chat";
import { brandingIdentity, shouldShowBranding } from "@/lib/branding";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) {
      return NextResponse.json(
        { error: "siteId required" },
        { status: 400, headers }
      );
    }

    const site = await prisma.websiteConfig.findUnique({
      where: { siteId },
      select: {
        siteId: true,
        name: true,
        botName: true,
        greeting: true,
        quickReplies: true,
        brandColor: true,
        enabled: true,
        launcherPosition: true,
        launcherOffset: true,
        launcherLabel: true,
        launcherIcon: true,
        theme: true,
        fontFamily: true,
        hideBranding: true,
        organization: { select: { planTier: true } },
        proactiveEnabled: true,
        proactiveMessage: true,
        proactiveDelaySeconds: true,
        proactiveCooldownHours: true,
        ctaLabel: true,
        ctaSelector: true,
        ctaUrl: true,
        organizationId: true,
      },
    });

    if (!site || !site.enabled) {
      return NextResponse.json(
        { error: "Site not found or disabled" },
        { status: 404, headers }
      );
    }

    // Feature gate: org must have chatbot enabled
    const orgSettings = await prisma.organizationSettings.findUnique({
      where: { organizationId: site.organizationId },
      select: { chatbotEnabled: true },
    });
    if (!orgSettings?.chatbotEnabled) {
      return NextResponse.json(
        { error: "Site not found or disabled" },
        { status: 404, headers }
      );
    }

    // Attribution is decided here, from the organisation's current plan —
    // never from the stored flag alone. A client who downgrades gets it back
    // on their next config fetch without anyone touching their site row.
    const branding = shouldShowBranding(
      site.organization?.planTier,
      site.hideBranding
    )
      ? { show: true, ...brandingIdentity() }
      : { show: false };

    // Strip anything internal before this reaches a public page.
    const {
      organizationId: _omitOrg,
      organization: _omitOrgRel,
      hideBranding: _omitFlag,
      ...publicConfig
    } = site;
    void _omitOrg;
    void _omitOrgRel;
    void _omitFlag;
    return NextResponse.json({ ...publicConfig, branding }, { headers });
  } catch (error) {
    console.error("[WEBSITE CHAT CONFIG] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
