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
import { getSalonConfig, selectProvider } from "@/lib/booking";
import { featureFlags, isStartPageChoice, resolveStartPage } from "@/lib/navigation";
import { contactNumberForTexts } from "@/lib/phone";
import { parseSalonFaq } from "@/lib/salon-knowledge";
import { checkSiteChat } from "@/lib/salon-chat";
import { bookingOrigin } from "@/lib/booking-host";
import {
  parseBrandColor,
  parseDaysAhead,
  parseHiddenServices,
  parseSiteText,
  SITE_ABOUT_MAX,
  SITE_ADDRESS_MAX,
  SITE_HEADLINE_MAX,
} from "@/lib/online-booking/catalogue";

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
  // Printed in every confirmation and reminder text. Missing from this list
  // for months, so the Settings field looked saved and was silently dropped,
  // and every text went out without a number to call.
  "contactPhone",
  "teamMembers",
  "businessHours",
  "timezone",
  "services",
  "voiceSystemPrompt",
  // The salon's FAQ, read by the receptionist and the chat bots.
  "salonFaq",
  // Rebooking texts: the salon's own choice (src/lib/rebook.ts).
  "rebookTextsEnabled",
  "whatsappSystemPrompt",
  "whatsappEnabled",
  "chatBookingEnabled",
  "diaryEnabled",
  "chatbotEnabled",
  "voiceEnabled",
  "calComApiKey",
  "calComEventTypeId",
  "instagramEnabled",
  "instagramSystemPrompt",
  "instagramBusinessId",
  "instagramUsername",
  "instagramAccessToken",
  "facebookEnabled",
  "facebookSystemPrompt",
  "facebookPageId",
  "facebookPageAccessToken",
  // The salon's own Meta app (meta-credentials.ts).
  "metaAppSecret",
  "instagramAppSecret",
  "metaVerifyToken",
  "whatsappAccessToken",
  "startPage",
  // Online booking and the salon's own website (src/lib/online-booking):
  // the salon's own choice, like rebooking texts.
  "onlineBookingEnabled",
  "siteHeadline",
  "siteAbout",
  "siteAddress",
  "siteBrandColor",
  "onlineMaxDaysAhead",
  "onlineStylistChoice",
  "onlineHiddenServices",
  // The salon's chat on its page (src/lib/salon-chat.ts): checked in PUT.
  "siteChatSiteId",
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
  // Only a page the CRM has; anything else (or empty) is "automatic".
  if ("salonFaq" in out) out.salonFaq = parseSalonFaq(out.salonFaq);
  if ("startPage" in out) out.startPage = isStartPageChoice(out.startPage) ? out.startPage : null;
  if ("rebookTextsEnabled" in out) out.rebookTextsEnabled = out.rebookTextsEnabled === true;
  if ("onlineBookingEnabled" in out) out.onlineBookingEnabled = out.onlineBookingEnabled === true;
  if ("onlineStylistChoice" in out) out.onlineStylistChoice = out.onlineStylistChoice !== false;
  if ("siteHeadline" in out) out.siteHeadline = parseSiteText(out.siteHeadline, SITE_HEADLINE_MAX);
  if ("siteAbout" in out) out.siteAbout = parseSiteText(out.siteAbout, SITE_ABOUT_MAX);
  if ("siteAddress" in out) out.siteAddress = parseSiteText(out.siteAddress, SITE_ADDRESS_MAX);
  if ("siteBrandColor" in out) out.siteBrandColor = parseBrandColor(out.siteBrandColor);
  if ("onlineMaxDaysAhead" in out) out.onlineMaxDaysAhead = parseDaysAhead(out.onlineMaxDaysAhead);
  if ("onlineHiddenServices" in out) out.onlineHiddenServices = parseHiddenServices(out.onlineHiddenServices);
  // As in ig.me/m/<username>: letters, digits, dots and underscores, no @.
  if ("instagramUsername" in out) {
    const u = typeof out.instagramUsername === "string" ? out.instagramUsername.trim().replace(/^@/, "") : "";
    out.instagramUsername = /^[A-Za-z0-9._]{1,30}$/.test(u) ? u : null;
  }

  return out;
}

// Fields only super-admins can change. Non-super-admins attempting to set
// these have them silently stripped from the update payload.
const SUPER_ADMIN_ONLY_FIELDS = [
  "whatsappSystemPrompt",
  "whatsappEnabled",
  "chatBookingEnabled",
  "diaryEnabled",
  "chatbotEnabled",
  "voiceEnabled",
  "calComApiKey",
  "calComEventTypeId",
  // Social channels — per-org tokens and system prompts stay behind the
  // super-admin gate, never mutable by regular tenants.
  "instagramEnabled",
  "instagramSystemPrompt",
  "instagramBusinessId",
  "instagramUsername",
  "instagramAccessToken",
  "facebookEnabled",
  "facebookSystemPrompt",
  "facebookPageId",
  "facebookPageAccessToken",
  "metaAppSecret",
  "instagramAppSecret",
  "metaVerifyToken",
  "whatsappAccessToken",
];

/**
 * The salon's keys and tokens are set by a super-admin and read only by the
 * server. Anyone else is told whether one is set, never what it is.
 */
const SECRET_FIELDS = [
  "calComApiKey",
  "instagramAccessToken",
  "facebookPageAccessToken",
  "metaAppSecret",
  "instagramAppSecret",
  "metaVerifyToken",
  "whatsappAccessToken",
] as const;

function withoutSecrets<T extends Record<string, unknown>>(settings: T): T {
  const out: Record<string, unknown> = { ...settings };
  for (const f of SECRET_FIELDS) out[f] = settings[f] ? "set" : null;
  return out as T;
}

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
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

    // Where this login opens, resolved here so the sidebar and the root
    // route agree without each re-deriving the diary's state.
    const cfg = await getSalonConfig(ctx.organizationId);
    const startPage = resolveStartPage({
      chosen: settings.startPage,
      flags: featureFlags(settings),
      diaryTakesBookings: selectProvider(cfg).capabilities.createBooking,
      isOwner: ctx.role !== "member",
    });

    // The name the sidebar heads with: this organisation's, including the one
    // a super-admin is viewing as, so it never shows another name first.
    const org = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true, slug: true, needsOnboarding: true },
    });

    return NextResponse.json({
      settings: ctx.isSuperAdmin ? settings : withoutSecrets(settings),
      // Onboarding first (src/app/onboarding), until the owner finishes it.
      // Never for a super-admin, who sets salons up from Admin instead.
      startPage: org?.needsOnboarding && !ctx.isSuperAdmin ? "/onboarding" : startPage,
      needsOnboarding: Boolean(org?.needsOnboarding) && !ctx.isSuperAdmin,
      organizationName: org?.name ?? null,
      // The salon's web address, /s/<slug> (src/lib/online-booking).
      organizationSlug: org?.slug ?? null,
      // Where salons' pages are given out (BOOKING_URL), or null for /s/<slug>
      // on the app's own address (src/lib/booking-host.ts).
      bookingOrigin: bookingOrigin(),
    });
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

    // Refused rather than stored as typed: a number nobody can ring is worse
    // in a text than no number, and the screen can say what is wrong.
    if ("contactPhone" in data) {
      const contact = contactNumberForTexts(data.contactPhone);
      if (!contact.ok) {
        return NextResponse.json(
          { error: `That contact number does not look right: ${contact.reason}` },
          { status: 400 }
        );
      }
      data.contactPhone = contact.value;
    }

    // Only one of this salon's own chats, from Websites.
    if ("siteChatSiteId" in data) {
      const chat = await checkSiteChat(ctx.organizationId, data.siteChatSiteId);
      if (chat === "invalid") {
        return NextResponse.json({ error: "That chat isn't one of this salon's." }, { status: 400 });
      }
      data.siteChatSiteId = chat;
    }

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

    // The same masking as GET: an owner saving their hours must not get the
    // salon's keys back in the response.
    return NextResponse.json({ settings: ctx.isSuperAdmin ? settings : withoutSecrets(settings) });
  } catch (error) {
    console.error("[SETTINGS API] PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
