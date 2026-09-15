import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import {
  openWeekdays,
  parseBusinessHours,
  parseTimezone,
  type BusinessHours,
} from "@/lib/business-hours";
import {
  constrainWorkingDays,
  parseServices,
  parseStylists,
  type Stylist,
} from "@/lib/salon-config";

const DEFAULT_SETTINGS = {
  businessName: "Our Business",
  teamMembers: [],
};

// Every column a tenant may write, by name.
//
// This route used to spread the request body straight into a Prisma update
// with only the id/org fields stripped. That was survivable while settings
// were inert text; it is not now that `businessHours` and `services` decide
// what the voice agent will book, and `voiceSystemPrompt` becomes prompt text.
// Anything not named here is dropped.
const WRITABLE_FIELDS = [
  "businessName",
  "teamMembers",
  "businessHours",
  "timezone",
  "services",
  "voiceSystemPrompt",
  "vapiAssistantId",
  "whatsappSystemPrompt",
  "whatsappEnabled",
  "chatbotEnabled",
  "voiceEnabled",
  "calComApiKey",
  "calComEventTypeId",
  "instagramEnabled",
  "instagramSystemPrompt",
  "instagramBusinessId",
  "instagramAccessToken",
  "facebookEnabled",
  "facebookSystemPrompt",
  "facebookPageId",
  "facebookPageAccessToken",
] as const;

/**
 * Normalise the JSON columns through the same parsers the booking code reads
 * them with, so a malformed value is rejected at the door rather than
 * surfacing at midnight as an agent that cannot check the diary.
 */
function sanitiseSettingsPayload(
  data: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of WRITABLE_FIELDS) {
    if (!(field in data)) continue;
    out[field] = data[field];
  }

  if ("businessHours" in out) out.businessHours = parseBusinessHours(out.businessHours);
  if ("services" in out) out.services = parseServices(out.services);
  if ("timezone" in out) out.timezone = parseTimezone(out.timezone);
  // teamMembers carries stylist calendar ids and working days now, so it goes
  // through the same treatment rather than being stored as arbitrary JSON.
  if ("teamMembers" in out) out.teamMembers = parseStylists(out.teamMembers);

  return out;
}

// Fields only super-admins can change. Non-super-admins attempting to set
// these have them silently stripped from the update payload.
const SUPER_ADMIN_ONLY_FIELDS = [
  "whatsappSystemPrompt",
  "whatsappEnabled",
  "chatbotEnabled",
  "voiceEnabled",
  "calComApiKey",
  "calComEventTypeId",
  // Social channels — per-org tokens and system prompts stay behind the
  // super-admin gate, never mutable by regular tenants.
  "instagramEnabled",
  "instagramSystemPrompt",
  "instagramBusinessId",
  "instagramAccessToken",
  "facebookEnabled",
  "facebookSystemPrompt",
  "facebookPageId",
  "facebookPageAccessToken",
];

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    let settings = await prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.organizationId },
    });

    if (!settings) {
      const org = await prisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { name: true },
      });
      settings = await prisma.organizationSettings.create({
        data: {
          organizationId: ctx.organizationId,
          businessName: org?.name || DEFAULT_SETTINGS.businessName,
          teamMembers: DEFAULT_SETTINGS.teamMembers,
        },
      });
    }

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[SETTINGS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const raw = await req.json();

    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Allowlist first — anything not explicitly writable is dropped, which
    // also covers the row id and org link.
    const data = sanitiseSettingsPayload(raw as Record<string, unknown>);

    // Strip super-admin-only fields unless the caller is a super-admin.
    if (ctx.role !== "superAdmin") {
      for (const f of SUPER_ADMIN_ONLY_FIELDS) {
        if (f in data) delete data[f];
      }
    }

    // A stylist cannot work on a day the salon is shut. Enforced on the way
    // in rather than only in the editor, because closing a day has to prune
    // it from everyone who had it — otherwise the team description keeps
    // offering callers a day that no longer exists.
    if ("teamMembers" in data || "businessHours" in data) {
      let hours = ("businessHours" in data
        ? (data.businessHours as BusinessHours)
        : null) as BusinessHours | null;
      let stylists = ("teamMembers" in data
        ? (data.teamMembers as Stylist[])
        : null) as Stylist[] | null;

      if (!hours || !stylists) {
        const current = await prisma.organizationSettings.findUnique({
          where: { organizationId: ctx.organizationId },
          select: { businessHours: true, teamMembers: true },
        });
        hours = hours ?? parseBusinessHours(current?.businessHours);
        stylists = stylists ?? parseStylists(current?.teamMembers);
      }

      data.teamMembers = constrainWorkingDays(stylists, openWeekdays(hours));
    }

    const settings = await prisma.organizationSettings.upsert({
      where: { organizationId: ctx.organizationId },
      update: data,
      create: {
        organizationId: ctx.organizationId,
        businessName:
          (data.businessName as string | undefined) ||
          DEFAULT_SETTINGS.businessName,
        ...data,
      },
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error("[SETTINGS API] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
