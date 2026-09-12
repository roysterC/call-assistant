import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenant, isErrorResponse } from "@/lib/tenant";

/**
 * Website-chat analytics for the customer, not for us.
 *
 * The existing /api/stats is entirely call-centric; the widget had no numbers
 * at all. The point of these particular metrics is to answer the only question
 * a paying client actually has — "is this earning its keep?" — so the headline
 * figures are leads captured and, above all, the share of conversations that
 * arrived outside working hours. That last one is the product's whole pitch
 * ("you're losing the enquiries you can't get to") expressed as a number the
 * client can check themselves.
 */

// No per-org timezone or business-hours fields exist yet, so this is stated
// plainly in the UI rather than pretending to be configurable. UK business
// hours are the right default for this customer base; when clients outside
// that appear, these belong on OrganizationSettings.
const BUSINESS_TZ = "Europe/London";
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req);
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const days = Math.min(
      365,
      Math.max(1, Number(searchParams.get("days")) || 30)
    );
    const siteId = searchParams.get("siteId");
    const orgId = ctx.organizationId;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Optional single-site scope, for orgs running the widget on more than one
    // property. Always combined with organizationId — never a substitute for it.
    const convWhere = {
      organizationId: orgId,
      createdAt: { gte: since },
      ...(siteId ? { siteId } : {}),
    };

    const [conversations, withLead, messageCount, sites] = await Promise.all([
      prisma.websiteConversation.count({ where: convWhere }),
      prisma.websiteConversation.count({
        where: { ...convWhere, leadId: { not: null } },
      }),
      prisma.websiteMessage.count({
        where: { conversation: convWhere },
      }),
      prisma.websiteConfig.findMany({
        where: { organizationId: orgId },
        select: { siteId: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    // Raw SQL for the time bucketing: Prisma has no groupBy on a date
    // expression. All three are parameterised — orgId and siteId reach the
    // query as bind values, never string interpolation.
    const daily = await prisma.$queryRaw<
      { day: string; conversations: number; leads: number }[]
    >`
      SELECT
        DATE("createdAt" AT TIME ZONE ${BUSINESS_TZ})::text AS day,
        COUNT(*)::int AS conversations,
        COUNT("leadId")::int AS leads
      FROM ca_website_conversations
      WHERE "organizationId" = ${orgId}
        AND "createdAt" >= ${since}
        AND (${siteId}::text IS NULL OR "siteId" = ${siteId}::text)
      GROUP BY day
      ORDER BY day ASC
    `;

    const hourly = await prisma.$queryRaw<{ hour: number; count: number }[]>`
      SELECT
        EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${BUSINESS_TZ})::int AS hour,
        COUNT(*)::int AS count
      FROM ca_website_conversations
      WHERE "organizationId" = ${orgId}
        AND "createdAt" >= ${since}
        AND (${siteId}::text IS NULL OR "siteId" = ${siteId}::text)
      GROUP BY hour
      ORDER BY hour ASC
    `;

    // Outside 09:00-17:00, or any time at the weekend. ISODOW puts Saturday
    // at 6 and Sunday at 7.
    const outOfHoursRow = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM ca_website_conversations
      WHERE "organizationId" = ${orgId}
        AND "createdAt" >= ${since}
        AND (${siteId}::text IS NULL OR "siteId" = ${siteId}::text)
        AND (
          EXTRACT(ISODOW FROM "createdAt" AT TIME ZONE ${BUSINESS_TZ}) > 5
          OR EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${BUSINESS_TZ}) < ${BUSINESS_START_HOUR}
          OR EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${BUSINESS_TZ}) >= ${BUSINESS_END_HOUR}
        )
    `;

    const topReferrers = await prisma.$queryRaw<
      { referrer: string; count: number }[]
    >`
      SELECT COALESCE(NULLIF("referrer", ''), 'Direct / unknown') AS referrer,
             COUNT(*)::int AS count
      FROM ca_website_conversations
      WHERE "organizationId" = ${orgId}
        AND "createdAt" >= ${since}
        AND (${siteId}::text IS NULL OR "siteId" = ${siteId}::text)
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 8
    `;

    const outOfHours = Number(outOfHoursRow[0]?.count ?? 0);

    return NextResponse.json({
      range: { days, since: since.toISOString(), timezone: BUSINESS_TZ },
      businessHours: {
        startHour: BUSINESS_START_HOUR,
        endHour: BUSINESS_END_HOUR,
      },
      totals: {
        conversations,
        leads: withLead,
        messages: messageCount,
        // Guarded rather than emitted as NaN — a brand new site legitimately
        // has zero of everything and the UI should show 0%, not "NaN%".
        conversionRate:
          conversations > 0
            ? Math.round((withLead / conversations) * 1000) / 10
            : 0,
        avgMessagesPerConversation:
          conversations > 0
            ? Math.round((messageCount / conversations) * 10) / 10
            : 0,
        outOfHours,
        outOfHoursRate:
          conversations > 0
            ? Math.round((outOfHours / conversations) * 1000) / 10
            : 0,
      },
      daily: daily.map((d) => ({
        day: d.day,
        conversations: Number(d.conversations),
        leads: Number(d.leads),
      })),
      hourly: hourly.map((h) => ({
        hour: Number(h.hour),
        count: Number(h.count),
      })),
      topReferrers: topReferrers.map((r) => ({
        referrer: r.referrer,
        count: Number(r.count),
      })),
      sites,
    });
  } catch (err) {
    console.error("[WEBSITE CHAT ANALYTICS] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
