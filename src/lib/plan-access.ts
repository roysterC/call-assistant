/**
 * The plan, read from the database: what a salon may use now (src/lib/plan.ts
 * decides), and the checks the routes and webhooks call.
 *
 *  - addonOn(orgId, addon): the receptionist, the chat replies, booking by
 *    message and rebooking texts each ask before they spend anything.
 *  - refuseIfRestricted(orgId): routes that make something new (a booking,
 *    a team member, a login) or change the salon's setup answer 402 while
 *    the salon is restricted. Checking out, cancelling and paying never ask.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  countPeople,
  isAddon,
  planState,
  PRICE_KEYS,
  seatsFor,
  withDefaults,
  type Addon,
  type PlanState,
  type PriceKey,
  type PriceList,
} from "@/lib/plan";

const PLAN_SELECT = {
  billingStatus: true,
  trialEndsAt: true,
  stripeSubscriptionId: true,
  addons: true,
  paymentFailedAt: true,
} as const;

export async function loadPlan(organizationId: string, now: Date = new Date()): Promise<PlanState | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: PLAN_SELECT });
  return org ? planState(org, now) : null;
}

/** Whether the add-on works for this salon now. A salon that is not found has none. */
export async function addonOn(organizationId: string, addon: Addon): Promise<boolean> {
  const plan = await loadPlan(organizationId);
  return Boolean(plan?.addonActive[addon]);
}

/**
 * The salon's plan said in a 402, for the screens to show: null when it may
 * go ahead. Kikai's super-admins, helping a salon, always may.
 */
export async function refuseIfRestricted(
  organizationId: string,
  ctx?: { isSuperAdmin?: boolean }
): Promise<NextResponse | null> {
  if (ctx?.isSuperAdmin) return null;
  const plan = await loadPlan(organizationId);
  if (!plan || plan.access === "full") return null;
  return NextResponse.json(
    {
      error: "Your plan is paused. Add or update your card in Settings → Plan & billing to carry on.",
      code: "plan_restricted",
    },
    { status: 402 }
  );
}

/** Everyone the salon pays for: the team, and logins that are not on it. */
export async function peopleOf(organizationId: string): Promise<number> {
  const [team, logins] = await Promise.all([
    prisma.technician.findMany({ where: { organizationId, archivedAt: null }, select: { userId: true } }),
    prisma.user.findMany({ where: { organizationId }, select: { id: true, role: true } }),
  ]);
  return countPeople(team, logins);
}

export async function seatsOf(organizationId: string): Promise<number> {
  return seatsFor(await peopleOf(organizationId));
}

export interface PriceRow {
  key: PriceKey;
  pence: number;
  stripePriceId: string | null;
}

/** Kikai's prices: the founder base and seat prices until set, and the add-ons that have one. */
export async function loadPrices(): Promise<{ prices: PriceList; rows: Partial<Record<PriceKey, PriceRow>> }> {
  const rows = await prisma.billingPrice.findMany();
  const byKey: Partial<Record<PriceKey, PriceRow>> = {};
  const prices: PriceList = {};
  for (const r of rows) {
    if (!(PRICE_KEYS as readonly string[]).includes(r.key)) continue;
    const key = r.key as PriceKey;
    byKey[key] = { key, pence: r.pence, stripePriceId: r.stripePriceId };
    prices[key] = r.pence;
  }
  return { prices: withDefaults(prices), rows: byKey };
}

/** Only the add-ons we know, each once. */
export function cleanAddons(v: unknown): Addon[] {
  return Array.isArray(v) ? [...new Set(v.filter(isAddon))] : [];
}
