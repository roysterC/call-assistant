/**
 * Saves a lead from the in-person funnel (/meet) into our own organisation's
 * Leads, as source "in_person". Public, because whoever fills it in has no
 * login, so: every answer is checked again here, a hidden field catches bots,
 * and one address can send only so many.
 *
 * Someone already on file (by email) is updated rather than duplicated.
 * Their business and name fill gaps, and where they stand on booking
 * systems replaces the old line.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkAnswers, systemSummary } from "@/lib/funnel";
import { upsertWebsiteLead } from "@/lib/website-lead";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { speakablePhone } from "@/lib/phone";

/** The organisation whose Leads page the funnel fills: ours. */
const ORG_SLUG = process.env.LEAD_FUNNEL_ORG_SLUG || "doai";

export async function POST(req: Request) {
  // A table at an event shares one connection, so this is generous: a burst
  // of twenty, then one every thirty seconds.
  const rl = rateLimit("funnel", clientIpFromHeaders(req.headers), { tokens: 20, refillPerSecond: 1 / 30 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many at once. Try again in a minute." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 400 });

  // A field no person sees. Anything in it is a bot: thank it and keep nothing.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ ok: true });
  }

  const checked = checkAnswers(body);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.message, field: checked.field }, { status: 400 });
  }
  const a = checked.value;

  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG }, select: { id: true } });
  if (!org) {
    console.error(`[FUNNEL] No organisation with slug "${ORG_SLUG}" to save leads to (LEAD_FUNNEL_ORG_SLUG)`);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }

  try {
    const lead = await upsertWebsiteLead({
      organizationId: org.id,
      email: a.email,
      name: a.ownerName,
      phone: a.phone,
      company: a.businessName,
      issue: systemSummary(a),
      source: "in_person",
    });
    // A number already on another lead is not moved onto this one (phone is
    // unique per organisation). It was typed in front of them, though, so it
    // goes on the line the Leads page shows rather than being lost.
    const saved = await prisma.lead.findUnique({ where: { id: lead.id }, select: { phone: true } });
    if (saved?.phone !== a.phone) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { issue: `${systemSummary(a)} · Phone ${speakablePhone(a.phone)} (also on another lead)` },
      });
    }
  } catch (error) {
    console.error("[FUNNEL] Could not save a lead:", error);
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
