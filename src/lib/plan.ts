/**
 * What a salon pays for, and what that lets it use. Pure: no database, so the
 * screens, the server and the tests share it.
 *
 * Every salon has the base plan, always: the diary, clients, booking from the
 * desk, sales and its own website with online booking. Nothing switches
 * those off. It costs the base price, which covers the owner, and the seat
 * price for each other person on the team, whether or not they sign in or
 * take bookings (seatsFor).
 *
 * The AI tools are add-ons, each with its own price (ADDONS). On a billed
 * salon an add-on works only while it is on the plan; the settings switches
 * (voiceEnabled and the rest) still say whether it is switched on and set up.
 *
 * Billing states (Organization.billingStatus):
 *  - "free":       not billed. Salons from before billing and Kikai's own.
 *                  Everything it has switched on works.
 *  - "trialing":   the 14-day free trial. With no card, the base plan only;
 *                  once a card is on file (a Stripe subscription), add-ons too.
 *  - "active":     paying.
 *  - "past_due":   a payment failed and Stripe is retrying it: everything
 *                  still works, with a warning to update the card.
 *  - "restricted": the trial ended with no card, Stripe gave up on a
 *                  payment, or the owner cancelled and the paid month ran
 *                  out. The salon keeps its bookings and can still check out,
 *                  cancel, add clients, block out time and pay; its website
 *                  still takes online bookings. The desk and the assistant
 *                  book nothing new, the team and setup cannot change
 *                  (src/lib/plan-access.ts), and no add-on works. Paused
 *                  salons may be wiped, least recently used first, as the
 *                  database fills (src/lib/purge.ts).
 */

export const ADDONS = ["receptionist", "chatReplies", "chatBooking", "rebookTexts"] as const;
export type Addon = (typeof ADDONS)[number];

export function isAddon(v: unknown): v is Addon {
  return typeof v === "string" && (ADDONS as readonly string[]).includes(v);
}

/**
 * Add-ons the owner adds herself. The receptionist needs a phone number set
 * up by Kikai first, so asking for it is a request Kikai answers in Admin.
 */
export const SELF_SERVE_ADDONS: readonly Addon[] = ["chatReplies", "chatBooking", "rebookTexts"];

/**
 * What an add-on works through: booking by message books in the chats, and a
 * rebooking text's link opens a chat that books. Adding one adds what it
 * needs (addonsWith); it works only while those are on the plan too.
 */
export const ADDON_NEEDS: Partial<Record<Addon, Addon>> = {
  chatBooking: "chatReplies",
  rebookTexts: "chatBooking",
};

/** The add-on and everything it works through. */
export function addonsWith(a: Addon): Addon[] {
  const out: Addon[] = [a];
  for (let n = ADDON_NEEDS[a]; n && !out.includes(n); n = ADDON_NEEDS[n]) out.push(n);
  return out;
}

/** The add-ons that need this one, which go when it goes. */
export function addonsNeeding(a: Addon): Addon[] {
  return ADDONS.filter((x) => x !== a && addonsWith(x).includes(a));
}

/** The plan's add-ons with this one added (and what it works through), or taken off (and what needs it). */
export function changedAddons(current: readonly Addon[], addon: Addon, on: boolean): Addon[] {
  const set = new Set(current);
  if (on) for (const a of addonsWith(addon)) set.add(a);
  else for (const a of [addon, ...addonsNeeding(addon)]) set.delete(a);
  return ADDONS.filter((a) => set.has(a));
}

export type PriceKey = "base" | "seat" | Addon;
export const PRICE_KEYS: readonly PriceKey[] = ["base", "seat", ...ADDONS];

/** The founder prices, in pence a month: used until Kikai sets others in Admin. */
export const DEFAULT_PENCE: Record<"base" | "seat", number> = { base: 900, seat: 500 };

export const TRIAL_DAYS = 14;

/** Pence a month for each price key; an add-on missing is not for sale. */
export type PriceList = Partial<Record<PriceKey, number>>;

export function withDefaults(prices: PriceList): PriceList {
  return { ...DEFAULT_PENCE, ...prices };
}

export const BILLING_STATUSES = ["free", "trialing", "active", "past_due", "restricted"] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

export interface PlanInput {
  billingStatus: string;
  trialEndsAt: Date | string | null;
  stripeSubscriptionId: string | null;
  addons: string[];
  paymentFailedAt?: Date | string | null;
}

export type Warning = "trialEnding" | "trialNoCard" | "paymentFailed" | "restricted" | null;

export interface PlanState {
  status: BillingStatus;
  /** "restricted": bookings stay; nothing new can be booked or added. */
  access: "full" | "restricted";
  /** Days left of the free trial, a part day counting as one (1 in its last 24 hours); null when not on trial. */
  trialDaysLeft: number | null;
  /** A card is on file: a Stripe subscription exists. */
  hasCard: boolean;
  /** Billed at all: false for a "free" salon. */
  billed: boolean;
  /** Whether each add-on works now. */
  addonActive: Record<Addon, boolean>;
  /** Add-ons on the plan (paid for, or to be paid for at the trial's end). */
  addons: Addon[];
  /** What to tell the owner, most urgent first. */
  warning: Warning;
}

const DAY = 24 * 60 * 60 * 1000;

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function planState(o: PlanInput, now: Date = new Date()): PlanState {
  const addons = ADDONS.filter((a) => o.addons.includes(a));
  const hasCard = Boolean(o.stripeSubscriptionId);
  const trialEnd = asDate(o.trialEndsAt);
  // An unknown state is the safe one for us: a typo costs the salon its
  // add-ons and new bookings until fixed, never us an unpaid month.
  let status: BillingStatus = (BILLING_STATUSES as readonly string[]).includes(o.billingStatus)
    ? (o.billingStatus as BillingStatus)
    : "restricted";
  // A trial with no card ends by itself: nothing has to run at midnight.
  if (status === "trialing" && !hasCard && trialEnd && trialEnd.getTime() <= now.getTime()) status = "restricted";

  const access = status === "restricted" ? "restricted" : "full";
  const trialDaysLeft =
    status === "trialing" && trialEnd ? Math.max(1, Math.ceil((trialEnd.getTime() - now.getTime()) / DAY)) : null;

  const on = (a: Addon): boolean => {
    if (status === "free") return true;
    if (access === "restricted") return false;
    // On trial with no card there is nothing to bill an add-on to.
    if (status === "trialing" && !hasCard) return false;
    return addonsWith(a).every((x) => addons.includes(x));
  };
  const addonActive = Object.fromEntries(ADDONS.map((a) => [a, on(a)])) as Record<Addon, boolean>;

  let warning: Warning = null;
  if (status === "restricted") warning = "restricted";
  else if (status === "past_due" || (status !== "free" && asDate(o.paymentFailedAt))) warning = "paymentFailed";
  else if (status === "trialing" && !hasCard) warning = trialDaysLeft !== null && trialDaysLeft <= 3 ? "trialEnding" : "trialNoCard";

  return { status, access, trialDaysLeft, hasCard, billed: status !== "free", addonActive, addons, warning };
}

/** The trial's end for a trial starting now. */
export function trialEnd(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DAYS * DAY);
}

/**
 * Stripe's subscription status as ours. "incomplete" is a first payment still
 * being made (3-D Secure): it keeps whatever the salon had, so null.
 */
export function fromStripeStatus(s: string): BillingStatus | null {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "incomplete":
      return null;
    // unpaid (Stripe gave up), canceled, incomplete_expired, paused
    default:
      return "restricted";
  }
}

/** People on the team: the owner is in the base price, each other one is a seat. */
export function seatsFor(people: number): number {
  return Math.max(0, people - 1);
}

/**
 * Count each person once: everyone on the team (taking bookings or not) and
 * every login that is not one of them. Kikai's own logins are not the salon's.
 */
export function countPeople(team: Array<{ userId: string | null }>, logins: Array<{ id: string; role: string }>): number {
  const onTeam = new Set(team.map((t) => t.userId).filter(Boolean));
  const others = logins.filter((u) => u.role !== "superAdmin" && !onTeam.has(u.id));
  return team.length + others.length;
}

export interface BillLine {
  key: PriceKey;
  quantity: number;
  pence: number;
}

/** The month's bill, line by line, and its total. An add-on with no price is left off. */
export function monthlyBill(prices: PriceList, seats: number, addons: readonly Addon[]): { lines: BillLine[]; total: number } {
  const p = withDefaults(prices);
  const lines: BillLine[] = [{ key: "base", quantity: 1, pence: p.base! }];
  if (seats > 0) lines.push({ key: "seat", quantity: seats, pence: p.seat! * seats });
  for (const a of ADDONS) if (addons.includes(a) && p[a] != null) lines.push({ key: a, quantity: 1, pence: p[a]! });
  return { lines, total: lines.reduce((n, l) => n + l.pence, 0) };
}

/** "£9", "£12.50". */
export function formatPence(pence: number, locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);
}
