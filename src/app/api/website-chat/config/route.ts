import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { corsHeaders } from "@/lib/website-chat";

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
        proactiveEnabled: true,
        proactiveMessage: true,
        proactiveDelaySeconds: true,
        proactiveCooldownHours: true,
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

    // Strip organizationId before returning
    const { organizationId: _omit, ...publicConfig } = site;
    void _omit;
    return NextResponse.json(publicConfig, { headers });
  } catch (error) {
    console.error("[WEBSITE CHAT CONFIG] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
