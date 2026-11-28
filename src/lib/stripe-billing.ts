/**
 * Stripe: each billed salon's subscription. The rules (prices, seats,
 * add-ons, states) are src/lib/plan.ts; Stripe takes the card, charges it
 * each month and tells us how that went (src/app/api/stripe/webhook).
 *
 * How the pieces fit:
 *  - A salon on its free trial adds a card through Stripe Checkout
 *    (startCheckout). The subscription it makes keeps the rest of the
 *    trial, so the first charge is the day the trial ends.
 *  - The subscription has one line per price: the base plan, the extra team
 *    members (quantity = seats), and one per add-on. syncSubscription makes
 *    its lines match the plan whenever the team or the add-ons change;
 *    Stripe works out the part-month.
 *  - Each price key is a Stripe Product with the fixed id "kikai_<key>", and
 *    each amount a Stripe Price on it, made the first time it is billed
 *    (ensurePrice). A price changed in Admin is a new Stripe Price: a line
 *    already on a subscription keeps the Price it was added with, which is
 *    how the founder price stays with the salons that joined on it.
 *  - Stripe's events set billingStatus (applySubscription) and note failed
 *    and paid invoices (paymentFailedAt).
 *  - Changing the card and seeing invoices is Stripe's own page
 *    (portalLink).
 *
 * Settings, on the server only: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
 * Without the key nothing is billed and stripeConfigured() is false.
 */

import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { notifyKikai } from "@/lib/notify";
import { loadPrices, seatsOf } from "@/lib/plan-access";
import { ADDONS, DEFAULT_PENCE, fromStripeStatus, isAddon, type PriceKey } from "@/lib/plan";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

let client: Stripe | null = null;
/** For tests: a fake client. */
export function setStripeClient(c: Stripe | null): void {
  client = c;
}

/** The Stripe client (set up from STRIPE_SECRET_KEY on first use). */
export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key, { appInfo: { name: "Kikai" } });
  }
  return client;
}

const PRODUCT_NAME: Record<PriceKey, string> = {
  base: "Kikai salon plan",
  seat: "Extra team member",
  receptionist: "Phone receptionist",
  chatReplies: "AI chat replies",
  chatBooking: "Booking by message",
  rebookTexts: "Rebooking texts",
};

const productId = (key: PriceKey) => `kikai_${key}`;

/**
 * The Stripe Price for this key at its current amount, made if it is new.
 * The Price made is recorded only if the amount is still the one it was made
 * for: an amount changed in Admin meanwhile is made again, never left with
 * the old Price.
 */
export async function ensurePrice(key: PriceKey, tries = 3): Promise<string> {
  const { rows } = await loadPrices();
  const row = rows[key];
  if (row?.stripePriceId) return row.stripePriceId;
  const pence = row?.pence ?? (key === "base" || key === "seat" ? DEFAULT_PENCE[key] : null);
  if (pence == null) throw new Error(`${PRODUCT_NAME[key]} has no price set in Admin`);

  const s = stripe();
  try {
    await s.products.retrieve(productId(key));
  } catch {
    await s.products.create({ id: productId(key), name: PRODUCT_NAME[key], metadata: { kikai_key: key } });
  }
  const price = await s.prices.create({
    product: productId(key),
    currency: "gbp",
    unit_amount: pence,
    recurring: { interval: "month" },
    metadata: { kikai_key: key },
  });
  if (row) {
    const kept = await prisma.billingPrice.updateMany({ where: { key, pence }, data: { stripePriceId: price.id } });
    if (kept.count === 0) {
      if (tries <= 1) throw new Error(`${PRODUCT_NAME[key]}'s price kept changing; try again`);
      return ensurePrice(key, tries - 1);
    }
  } else {
    // The founder base or seat price, never set in Admin: recorded now. One
    // set in Admin at the same moment wins, and is made on the next try.
    const made = await prisma.billingPrice.createMany({ data: [{ key, pence, stripePriceId: price.id }], skipDuplicates: true });
    if (made.count === 0) {
      if (tries <= 1) throw new Error(`${PRODUCT_NAME[key]}'s price kept changing; try again`);
      return ensurePrice(key, tries - 1);
    }
  }
  return price.id;
}

interface WantedLine {
  key: PriceKey;
  quantity: number;
}

/**
 * The lines the subscription should have: the plan, the seats, and each
 * add-on on the plan. An add-on taken off sale stays on the plans that have
 * it, and so stays billed at the Price its line already has.
 */
async function wantedLines(organizationId: string, existing: ReadonlySet<PriceKey> = new Set()): Promise<WantedLine[]> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { addons: true } });
  const seats = await seatsOf(organizationId);
  const { prices } = await loadPrices();
  // The seat line stays on a subscription at 0 when the team is the owner
  // alone, so it keeps the price it joined on for the next hire.
  const lines: WantedLine[] = [
    { key: "base", quantity: 1 },
    { key: "seat", quantity: seats },
  ];
  // An add-on with no price is billed only on a line it already has: one
  // newly on the plan waits for a price rather than stopping the card or
  // every later change (ensurePrice cannot make a Price without an amount).
  for (const a of ADDONS) if (org?.addons.includes(a) && (prices[a] != null || existing.has(a))) lines.push({ key: a, quantity: 1 });
  return lines;
}

/**
 * Add-ons on the plan with no price and no line already billing them come
 * off the plan: nothing could bill them, and on the plan they would work
 * for free. (Kikai can only add an add-on that has a price; this catches
 * one taken off sale before the salon added its card.)
 */
async function dropUnpricedAddons(organizationId: string, existing: ReadonlySet<PriceKey>): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { addons: true } });
  const { prices } = await loadPrices();
  const keep = (org?.addons ?? []).filter((a) => !isAddon(a) || prices[a] != null || existing.has(a));
  if (org && keep.length !== org.addons.length) {
    await prisma.organization.update({ where: { id: organizationId }, data: { addons: keep } });
  }
}

/** Which of our prices a subscription line is, from the Price's (or its Product's) mark. */
function lineKey(item: Stripe.SubscriptionItem): PriceKey | null {
  const k = item.price.metadata?.kikai_key;
  if (k) return k as PriceKey;
  const product = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
  return product.startsWith("kikai_") ? (product.slice("kikai_".length) as PriceKey) : null;
}

/** The salon's Stripe customer, made the first time it is needed. */
async function ensureCustomer(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      stripeCustomerId: true,
      users: { where: { role: "admin" }, select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!org) throw new Error("No such salon");
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const customer = await stripe().customers.create({
    name: org.name,
    email: org.users[0]?.email,
    metadata: { organizationId },
  });
  // Only if still unset: two clicks at once make one customer that is used.
  const set = await prisma.organization.updateMany({
    where: { id: organizationId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  });
  if (set.count === 1) return customer.id;
  const again = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeCustomerId: true } });
  return again!.stripeCustomerId!;
}

/** Stripe needs a trial to end at least two days ahead; a shorter one is charged now. */
const MIN_TRIAL_MS = 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000;

/**
 * Stripe's page to add a card and start the subscription. The rest of the
 * free trial, if any, carries over: the card is charged when it ends.
 */
export async function startCheckout(
  organizationId: string,
  urls: { success: string; cancel: string }
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { billingStatus: true, trialEndsAt: true, stripeSubscriptionId: true },
  });
  if (!org) return { ok: false, error: "No such salon" };
  if (org.stripeSubscriptionId) return { ok: false, error: "This salon already has a card on file." };
  if (org.billingStatus === "free") return { ok: false, error: "This salon is not billed." };

  const customer = await ensureCustomer(organizationId);
  // A Checkout page opened for the salon in the last half hour (a second
  // tab, a double click) is the one to go to: one page can only make one
  // subscription. An older one is closed: its trial end and team were fixed
  // when it was made, and may no longer hold.
  const open = await stripe().checkout.sessions.list({ customer, status: "open", limit: 10 });
  const fresh = Date.now() / 1000 - 30 * 60;
  const reuse = open.data.find((x) => x.mode === "subscription" && x.url && x.created >= fresh);
  if (reuse?.url) return { ok: true, url: reuse.url };
  for (const old of open.data) if (old.mode === "subscription") await stripe().checkout.sessions.expire(old.id).catch(() => {});

  await dropUnpricedAddons(organizationId, new Set());
  const lines = (await wantedLines(organizationId)).filter((l) => l.quantity > 0);
  const lineItems = [];
  for (const l of lines) lineItems.push({ price: await ensurePrice(l.key), quantity: l.quantity });
  // The rest of the free trial carries over. Stripe takes a trial only if
  // it has two days left; a shorter rest is kept free by starting the first
  // month on the day the trial ends instead, with nothing charged before.
  const end = org.trialEndsAt && org.trialEndsAt.getTime() > Date.now() + 60 * 60 * 1000 ? org.trialEndsAt : null;
  const endSecs = end ? Math.floor(end.getTime() / 1000) : null;
  const keepTrial =
    endSecs && end!.getTime() - Date.now() > MIN_TRIAL_MS
      ? { trial_end: endSecs }
      : endSecs
        ? { billing_cycle_anchor: endSecs, proration_behavior: "none" as const }
        : {};

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: organizationId,
    line_items: lineItems,
    subscription_data: {
      metadata: { organizationId },
      ...keepTrial,
    },
    // Take the card even while the trial means nothing is due today.
    payment_method_collection: "always",
    success_url: urls.success,
    cancel_url: urls.cancel,
  });
  if (!session.url) return { ok: false, error: "Stripe did not give a page to go to." };
  return { ok: true, url: session.url };
}

/** Stripe's own page for the salon's card and invoices. */
export async function portalLink(organizationId: string, returnUrl: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeCustomerId: true } });
  if (!org?.stripeCustomerId) return null;
  const session = await stripe().billingPortal.sessions.create({ customer: org.stripeCustomerId, return_url: returnUrl });
  return session.url;
}

/**
 * Make the subscription's lines match the plan: the seats, and the add-ons
 * added or taken off. A line kept keeps its Price (the amount it joined on).
 * Nothing to do for a salon with no subscription, or with Stripe not set up.
 */
export async function syncSubscription(
  organizationId: string
): Promise<{ ok: true; changed?: boolean } | { ok: false; error: string }> {
  if (!stripeConfigured()) return { ok: true };
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { stripeSubscriptionId: true },
  });
  if (!org?.stripeSubscriptionId) return { ok: true };
  try {
    // One at a time per salon: two at once (an add-on added while a team
    // change is being billed) would each add the same line.
    return await withBillingLock(organizationId, () => syncLinesNow(organizationId));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[BILLING] could not bring ${organizationId}'s subscription up to date:`, error);
    return { ok: false, error };
  }
}

/**
 * syncSubscription for a caller already holding the salon's billing lease
 * (withBillingLock), which must not wait on itself.
 */
export async function syncLinesNow(organizationId: string): Promise<{ ok: true; changed: boolean }> {
  if (!stripeConfigured()) return { ok: true, changed: false };
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeSubscriptionId: true } });
  if (!org?.stripeSubscriptionId) return { ok: true, changed: false };
  return syncLines(organizationId, org.stripeSubscriptionId);
}

/** Another change to the salon's billing held its lease for the whole wait. */
export class BillingBusyError extends Error {
  constructor() {
    super("Another change to this salon's billing is still running; try again.");
  }
}

const LEASE_MS = 60_000;
const LEASE_WAIT_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` holding this salon's billing lease: a short claim on its row
 * (billingLockUntil), taken with one conditional update and given back
 * after. Unlike a lock held in a transaction, it keeps no database
 * connection while Stripe is called. A lease left by a crash runs out by
 * itself. Waits up to half a minute for another change to finish.
 */
export async function withBillingLock<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  const until = Date.now() + LEASE_WAIT_MS;
  for (let wait = 100; ; wait = Math.min(wait * 2, 2000)) {
    const now = new Date();
    const lease = new Date(now.getTime() + LEASE_MS);
    const taken = await prisma.organization.updateMany({
      where: { id: organizationId, OR: [{ billingLockUntil: null }, { billingLockUntil: { lt: now } }] },
      data: { billingLockUntil: lease },
    });
    if (taken.count === 1) {
      // Renewed while it runs, so a slow Stripe never lets a second change in.
      let held = lease;
      const renew = setInterval(() => {
        const next = new Date(Date.now() + LEASE_MS);
        prisma.organization
          .updateMany({ where: { id: organizationId, billingLockUntil: held }, data: { billingLockUntil: next } })
          .then((r) => {
            if (r.count === 1) held = next;
          })
          .catch(() => {});
      }, LEASE_MS / 3);
      try {
        return await fn();
      } finally {
        clearInterval(renew);
        await prisma.organization
          .updateMany({ where: { id: organizationId, billingLockUntil: held }, data: { billingLockUntil: null } })
          .catch(() => {});
      }
    }
    if (Date.now() + wait > until) throw new BillingBusyError();
    await sleep(wait);
  }
}

async function syncLines(organizationId: string, subscriptionId: string): Promise<{ ok: true; changed: boolean }> {
  const s = stripe();
  const sub = await s.subscriptions.retrieve(subscriptionId);
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return { ok: true, changed: false };
  const existing = new Set(sub.items.data.map(lineKey).filter((k): k is PriceKey => k !== null));
  const wanted = await wantedLines(organizationId, existing);
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  const have = new Map<PriceKey, Stripe.SubscriptionItem>();
  for (const item of sub.items.data) {
    const key = lineKey(item);
    if (!key) continue; // a line Kikai added by hand in Stripe: left alone
    const want = wanted.find((w) => w.key === key);
    if (!want || have.has(key)) items.push({ id: item.id, deleted: true });
    else {
      have.set(key, item);
      if (item.quantity !== want.quantity) items.push({ id: item.id, quantity: want.quantity });
    }
  }
  await dropUnpricedAddons(organizationId, existing);
  for (const w of wanted) if (!have.has(w.key) && w.quantity > 0) items.push({ price: await ensurePrice(w.key), quantity: w.quantity });
  if (items.length) {
    await s.subscriptions.update(sub.id, { items, proration_behavior: "create_prorations" });
  }
  const seats = wanted.find((w) => w.key === "seat")?.quantity ?? 0;
  await prisma.organization.update({ where: { id: organizationId }, data: { billedSeats: seats } });
  return { ok: true, changed: items.length > 0 };
}

/**
 * After the team or its logins change: bill the new number of people. Never
 * throws and never holds up the change itself; a failure is logged, and the
 * next change, or Admin, brings it up to date.
 */
export async function afterTeamChange(organizationId: string): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeSubscriptionId: true, billedSeats: true },
    });
    if (!org?.stripeSubscriptionId) return;
    if ((await seatsOf(organizationId)) === org.billedSeats) return;
    await syncSubscription(organizationId);
  } catch (e) {
    console.error(`[BILLING] team change for ${organizationId} not billed:`, e);
  }
}

/** The salon a Stripe object is for: by its subscription, its customer, or the id we put on it. */
export async function orgFor(ref: { subscription?: string | null; customer?: string | null; organizationId?: string | null }) {
  const or = [
    ...(ref.subscription ? [{ stripeSubscriptionId: ref.subscription }] : []),
    ...(ref.customer ? [{ stripeCustomerId: ref.customer }] : []),
    ...(ref.organizationId ? [{ id: ref.organizationId }] : []),
  ];
  if (!or.length) return null;
  return prisma.organization.findFirst({ where: { OR: or }, select: { id: true, stripeSubscriptionId: true, billingStatus: true } });
}

/**
 * Stripe's word on a subscription: its state, and whether it is the salon's.
 *
 * With `fresh`, the subscription is read from Stripe as it is now rather
 * than as the event had it: events come late, twice and out of order, and an
 * old "active" must never bring back a subscription since cancelled.
 */
export async function applySubscription(sub: Stripe.Subscription, opts: { fresh?: boolean } = {}): Promise<string | null> {
  if (opts.fresh) {
    const now = await stripe().subscriptions.retrieve(sub.id);
    sub = now.metadata?.organizationId || !sub.metadata?.organizationId ? now : { ...now, metadata: sub.metadata };
  }
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const org = await orgFor({ subscription: sub.id, customer, organizationId: sub.metadata?.organizationId });
  if (!org) {
    console.warn(`[BILLING] subscription ${sub.id} matches no salon`);
    return null;
  }
  // Stripe gave up on a payment: the subscription is ended here, and what it
  // still owes written off, so the salon is never charged for the months it
  // spends paused. Adding a card again starts a fresh month (startCheckout).
  if (sub.status === "unpaid" && org.stripeSubscriptionId === sub.id) {
    await cancelSubscriptionNow(sub.id);
    sub = { ...sub, status: "canceled" };
  }
  const status = fromStripeStatus(sub.status);
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  if (org.stripeSubscriptionId && org.stripeSubscriptionId !== sub.id) {
    // A second subscription for a salon that has one (two Checkout pages
    // finished): cancelled, so the card is not charged twice. Otherwise an
    // old one's events, after it ended: nothing to do.
    if (!ended) {
      console.warn(`[BILLING] ${org.id} already has ${org.stripeSubscriptionId}; cancelling the second, ${sub.id}`);
      await cancelDuplicate(org.id, sub.id);
    }
    return org.id;
  }
  if (!org.stripeSubscriptionId) {
    // Not (or no longer) the salon's: an ended one is not taken back on.
    if (ended) return org.id;
    // A first payment still being made (3-D Secure) is not a card on file
    // yet: it is taken on once Stripe says it is paid.
    if (sub.status === "incomplete") return org.id;
    // Taken on only if still nobody's: two finished at once (two Checkout
    // tabs) both read "none", and only one can win this. The other is
    // cancelled, so the card is not charged twice.
    const claimed = await prisma.organization.updateMany({
      where: { id: org.id, stripeSubscriptionId: null },
      data: { stripeSubscriptionId: sub.id },
    });
    if (claimed.count !== 1) {
      const now = await prisma.organization.findUnique({ where: { id: org.id }, select: { stripeSubscriptionId: true } });
      if (now?.stripeSubscriptionId !== sub.id) {
        console.warn(`[BILLING] ${org.id} took another subscription meanwhile; cancelling ${sub.id}`);
        await cancelDuplicate(org.id, sub.id);
        return org.id;
      }
    }
  }
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      ...(status && org.billingStatus !== "free" ? { billingStatus: status } : {}),
      // An ended subscription is let go, so the salon can add a card again.
      stripeSubscriptionId: ended ? null : sub.id,
      stripeCustomerId: customer,
      ...(sub.trial_end ? { trialEndsAt: new Date(sub.trial_end * 1000) } : {}),
      // Cancelled by the owner: when it ends (the paid month's end).
      cancelAt: ended ? null : cancelDate(sub),
      // Paid, or over: either way no payment is waiting on the salon.
      ...(status === "active" || status === "trialing" || ended ? { paymentFailedAt: null } : {}),
      // Paying again withdraws a warning that the salon is about to be wiped.
      ...(status === "active" || status === "trialing" ? { purgeWarnedAt: null } : {}),
    },
  });
  return org.id;
}

/** The app's own address, for links in Kikai's emails sent outside a request. */
function appOrigin(): string {
  try {
    return new URL(process.env.AUTH_URL ?? "").origin;
  } catch {
    return "https://app.getkikai.com";
  }
}

/**
 * Cancel a second subscription for a salon that has one. One already
 * charged (no trial left) is not refunded by cancelling: Kikai is emailed
 * to refund it in Stripe. Checkout pages are reused, so this is rare.
 */
async function cancelDuplicate(organizationId: string, subscriptionId: string): Promise<void> {
  const s = stripe();
  const sub = await s.subscriptions.retrieve(subscriptionId);
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return;
  await s.subscriptions.cancel(subscriptionId);
  const paid = await s.invoices.list({ subscription: subscriptionId, status: "paid", limit: 5 });
  const charged = paid.data.filter((i) => i.amount_paid > 0);
  if (charged.length) {
    await notifyKikai({
      subject: "A duplicate subscription was charged: refund it in Stripe",
      lines: [
        `A salon finished two Checkout pages. The second subscription (${subscriptionId}) was cancelled, but it had already taken ${charged.length} payment(s).`,
        `Refund ${charged.map((i) => i.number ?? i.id).join(", ")} in Stripe.`,
      ],
      button: "Open the salon in Admin",
      url: `${appOrigin()}/admin/organizations/${organizationId}`,
    });
  }
}

/** When a subscription set to cancel ends: its own date, or the end of the period it has paid for. */
function cancelDate(sub: Stripe.Subscription): Date | null {
  if (sub.cancel_at) return new Date(sub.cancel_at * 1000);
  if (!sub.cancel_at_period_end) return null;
  const ends = sub.items?.data?.map((i) => i.current_period_end).filter(Boolean) ?? [];
  if (ends.length) return new Date(Math.max(...ends) * 1000);
  return sub.trial_end ? new Date(sub.trial_end * 1000) : null;
}

/**
 * The owner cancels their plan, or changes their mind. It carries on to the
 * end of the month (or trial) already paid for, then ends: no refund, no
 * further charge. Stripe's word is written back at once.
 */
export async function setCancelAtPeriodEnd(organizationId: string, cancel: boolean): Promise<{ ok: true; endsAt: Date | null } | { ok: false; error: string }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { stripeSubscriptionId: true } });
  if (!org?.stripeSubscriptionId) return { ok: false, error: "No card on file." };
  try {
    const sub = await stripe().subscriptions.update(org.stripeSubscriptionId, { cancel_at_period_end: cancel });
    await applySubscription(sub);
    return { ok: true, endsAt: cancelDate(sub) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[BILLING] could not ${cancel ? "cancel" : "keep"} ${organizationId}'s plan:`, error);
    return { ok: false, error };
  }
}

/** The subscription an invoice is for, where the API version keeps it. */
export function invoiceSubscription(inv: Stripe.Invoice): string | null {
  const sub = inv.parent?.subscription_details?.subscription;
  return sub ? (typeof sub === "string" ? sub : sub.id) : null;
}

/** A payment that failed: noted once, for the warning; Stripe retries it. */
export async function invoiceFailed(inv: Stripe.Invoice): Promise<string | null> {
  const customer = typeof inv.customer === "string" ? inv.customer : (inv.customer?.id ?? null);
  const org = await orgFor({ subscription: invoiceSubscription(inv), customer });
  if (!org) return null;
  await prisma.organization.updateMany({ where: { id: org.id, paymentFailedAt: null }, data: { paymentFailedAt: new Date() } });
  return org.id;
}

/** A payment that went through: the warning goes. */
export async function invoicePaid(inv: Stripe.Invoice): Promise<string | null> {
  const customer = typeof inv.customer === "string" ? inv.customer : (inv.customer?.id ?? null);
  const org = await orgFor({ subscription: invoiceSubscription(inv), customer });
  if (!org) return null;
  await prisma.organization.update({ where: { id: org.id }, data: { paymentFailedAt: null } });
  return org.id;
}

/**
 * Checkout finished: the subscription is the salon's from now. Its lines are
 * then brought up to date, for a team that changed while the page was open.
 */
export async function checkoutDone(session: Stripe.Checkout.Session): Promise<string | null> {
  if (session.mode !== "subscription" || !session.subscription) return null;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const sub = await stripe().subscriptions.retrieve(subId);
  if (!sub.metadata?.organizationId && session.client_reference_id) {
    sub.metadata = { ...sub.metadata, organizationId: session.client_reference_id };
  }
  const orgId = await applySubscription(sub);
  if (orgId) await syncSubscription(orgId);
  return orgId;
}

/** Try the salon's unpaid invoices again, after it has changed its card. */
export async function retryPayment(organizationId: string): Promise<{ ok: boolean; error?: string }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { stripeCustomerId: true, stripeSubscriptionId: true },
  });
  if (!org?.stripeCustomerId) return { ok: false, error: "No card on file." };
  if (!org.stripeSubscriptionId) return { ok: false, error: "No card on file." };
  const s = stripe();
  // Only what the current subscription owes: never an older one's.
  const open = await s.invoices.list({ subscription: org.stripeSubscriptionId, status: "open", limit: 10 });
  try {
    for (const inv of open.data) if (inv.id) await s.invoices.pay(inv.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // The subscription's new state comes by webhook too; read it now so the
  // salon sees it straight away.
  if (org.stripeSubscriptionId) await applySubscription(await s.subscriptions.retrieve(org.stripeSubscriptionId));
  return { ok: true };
}

/**
 * Cancel a subscription in Stripe at once, with no part-month charged, and
 * void anything it still owes, so the card is never charged again. Ours is
 * left as it is: the caller decides what the salon becomes.
 */
export async function cancelSubscriptionNow(subscriptionId: string): Promise<void> {
  const s = stripe();
  const sub = await s.subscriptions.retrieve(subscriptionId);
  if (sub.status !== "canceled" && sub.status !== "incomplete_expired") {
    await s.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
  }
  const open = await s.invoices.list({ subscription: subscriptionId, status: "open", limit: 100 });
  for (const inv of open.data) if (inv.id) await s.invoices.voidInvoice(inv.id);
}

/**
 * Make a salon that pays by card not billed (a tester, or Kikai's own): its
 * subscription is cancelled at once in Stripe, with no part-month charged,
 * and anything it still owes is voided, so the card is never charged again.
 * Only then is the salon marked "free"; if Stripe refuses, nothing changes.
 * Its Stripe customer is kept, with its invoice history.
 */
export async function stopBillingForFree(organizationId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { stripeSubscriptionId: true },
  });
  if (!org) return { ok: false, error: "No such salon" };
  try {
    await withBillingLock(organizationId, async () => {
      if (org.stripeSubscriptionId) {
        // Never let go of a live subscription we cannot cancel.
        if (!stripeConfigured()) throw new Error("Stripe is not set up here: cancel the subscription in Stripe first");
        await cancelSubscriptionNow(org.stripeSubscriptionId);
      }
      await prisma.organization.update({
        where: { id: organizationId },
        data: { billingStatus: "free", stripeSubscriptionId: null, paymentFailedAt: null, billedSeats: null },
      });
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[BILLING] could not stop billing ${organizationId}:`, error);
    return { ok: false, error };
  }
}
