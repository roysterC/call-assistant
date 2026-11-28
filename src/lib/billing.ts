/**
 * The salon's bill, as the Plan & billing screen and Admin show it, and the
 * changes they make to it. The rules are src/lib/plan.ts; this reads and
 * writes them.
 */

import { prisma } from "@/lib/prisma";
import { loadPrices, peopleOf } from "@/lib/plan-access";
import {
  isAddon,
  monthlyBill,
  planState,
  seatsFor,
  type Addon,
  type BillLine,
  type PlanState,
  type PriceList,
} from "@/lib/plan";

export interface BillingSummary {
  plan: PlanState;
  trialEndsAt: string | null;
  /** Everyone on the team and every other login: the owner is in the base price. */
  people: number;
  seats: number;
  prices: PriceList;
  /** What next month costs as the plan stands. */
  bill: { lines: BillLine[]; total: number };
  addonRequests: Addon[];
  hasStripeCustomer: boolean;
}

export async function billingSummary(organizationId: string): Promise<BillingSummary | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      billingStatus: true,
      trialEndsAt: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      addons: true,
      addonRequests: true,
      paymentFailedAt: true,
      cancelAt: true,
    },
  });
  if (!org) return null;
  const plan = planState(org);
  const [people, { prices }] = await Promise.all([peopleOf(organizationId), loadPrices()]);
  const seats = seatsFor(people);
  return {
    plan,
    trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
    people,
    seats,
    prices,
    bill: monthlyBill(prices, seats, plan.addons),
    // Asked for and not yet on the plan.
    addonRequests: org.addonRequests.filter((a): a is Addon => isAddon(a) && !plan.addons.includes(a)),
    hasStripeCustomer: Boolean(org.stripeCustomerId),
  };
}
