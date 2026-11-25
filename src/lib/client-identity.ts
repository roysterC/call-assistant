/**
 * Who a client is: the one place every channel asks.
 *
 * One card per person (`Lead`). A number or an email is not a person: a
 * family shares a phone, a couple an email, so neither is unique. What
 * decides whether a detail may find a client already on file is how sure we
 * are it is theirs:
 *
 * - Proved: the number a call comes from (caller ID), the WhatsApp number a
 *   message comes from, a chat already filed under a client, or anything the
 *   salon's staff type at the desk. These find the client who has them.
 * - Typed: a number or email given on the website, in an Instagram or
 *   Messenger chat, or a number said on a call that is not the one ringing.
 *   Anyone can give a client's. These never open, change or book onto a
 *   client on file: they make a new card, marked as possibly the same person
 *   as the client they matched, for the salon to merge or clear.
 *
 * A number's own client is the first card given it (of those not deleted):
 * who a call or a WhatsApp from it reaches. Anyone else on it is told apart
 * by name, or reached through it (client-link.ts).
 */

import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/phone";
import type { Tx } from "@/lib/booking-number";
import { namesMatch } from "@/lib/client-name";

export type Db = Tx | typeof prisma;
type LeadRow = NonNullable<Awaited<ReturnType<typeof prisma.lead.findFirst>>>;

/** How sure we are a number or email is the person's own. */
export type Proof = "proved" | "typed";

/** The client a number reaches: its first card, or null. */
export function numberHolder(db: Db, organizationId: string, phone: string): Promise<LeadRow | null> {
  return db.lead.findFirst({
    where: { organizationId, phone, anonymisedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** Every client with this number, first card first. */
export function clientsOnNumber(db: Db, organizationId: string, phone: string): Promise<LeadRow[]> {
  return db.lead.findMany({
    where: { organizationId, phone, anonymisedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** The first client with this email (stored lower-cased), or null. */
export function emailHolder(db: Db, organizationId: string, email: string): Promise<LeadRow | null> {
  return db.lead.findFirst({
    where: { organizationId, email: email.trim().toLowerCase(), anonymisedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Run `fn` with nobody else choosing or making a client for this number (or
 * email) at the same time: two WhatsApps a moment apart from someone new
 * would otherwise each make her a card. What the unique index used to do.
 */
export async function withClientLock<T>(organizationId: string, key: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`client|${organizationId}|${key}`}))`;
      return fn(tx);
    },
    { timeout: 15_000, maxWait: 10_000 }
  );
}

/**
 * The client a proved number reaches, made (with `name`) if nobody has it.
 * A name given here only names a new card: an existing client's is not
 * changed by it.
 */
export async function clientForNumber(
  organizationId: string,
  phone: string,
  opts: { name?: string | null; source: string }
): Promise<LeadRow> {
  return withClientLock(organizationId, phone, async (tx) => {
    const held = await numberHolder(tx, organizationId, phone);
    if (held) return held;
    return tx.lead.create({
      data: { organizationId, phone, name: opts.name?.trim() || null, source: opts.source },
    });
  });
}

/** What someone typed about themselves. */
export interface TypedDetails {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  issue?: string | null;
  notes?: string | null;
  source: string;
  /** Reached through another client's number (a child on a parent's). */
  contactLeadId?: string | null;
}

/**
 * A new client from typed details. Never one already on file: if a client
 * has the number or email, the new card is marked as possibly her
 * (`possibleDuplicateOfId`), and the salon merges the two or clears it.
 *
 * The number is kept in the form every number is stored in (+447700900123),
 * so it is found when they ring; one that is not a number is left off. It is
 * kept even when another client has it: it is the one they gave, and her
 * card is not touched. The email is kept lower-cased.
 */
export async function newClientFromTyped(db: Db, organizationId: string, d: TypedDetails): Promise<LeadRow> {
  const parsed = normalisePhone(d.phone ?? undefined);
  const phone = parsed.ok ? parsed.e164 : null;
  const email = d.email?.trim().toLowerCase() || null;
  const like = await possibleMatch(db, organizationId, { phone, email, name: d.name ?? null, contactLeadId: d.contactLeadId ?? null });
  return db.lead.create({
    data: {
      organizationId,
      name: d.name?.trim() || null,
      email,
      phone,
      company: d.company?.trim() || null,
      issue: d.issue?.trim().slice(0, 500) || null,
      notes: d.notes?.trim() || null,
      source: d.source,
      contactLeadId: d.contactLeadId ?? null,
      possibleDuplicateOfId: like?.id ?? null,
    },
  });
}

/**
 * The client a typed card may be: one with its number and the same name, a
 * client reached through that number under the name, then the number's own
 * client, then the first with its email. Null when nobody has either.
 */
async function possibleMatch(
  db: Db,
  organizationId: string,
  d: { phone: string | null; email: string | null; name: string | null; contactLeadId: string | null }
): Promise<{ id: string } | null> {
  if (d.phone) {
    const on = await clientsOnNumber(db, organizationId, d.phone);
    const named = d.name ? on.find((c) => namesMatch(c.name, d.name)) : undefined;
    if (named) return named;
    if (d.name && on[0]) {
      const reached = await db.lead.findMany({
        where: { organizationId, contactLeadId: on[0].id, anonymisedAt: null },
        select: { id: true, name: true },
      });
      const through = reached.find((c) => namesMatch(c.name, d.name));
      if (through) return through;
    }
    if (on[0]) return on[0];
  }
  if (d.contactLeadId && d.name) {
    const reached = await db.lead.findMany({
      where: { organizationId, contactLeadId: d.contactLeadId, anonymisedAt: null },
      select: { id: true, name: true },
    });
    const through = reached.find((c) => namesMatch(c.name, d.name));
    if (through) return through;
  }
  if (d.email) return emailHolder(db, organizationId, d.email);
  return null;
}

/**
 * Whether `phone` is proved: the number the call or WhatsApp is coming from.
 * Anything else said or typed is not, however right it may be.
 */
export function isOwnNumber(phone: string, callerNumber: string | null | undefined): boolean {
  const own = normalisePhone(callerNumber ?? undefined);
  return own.ok && own.e164 === phone;
}

/**
 * Fill what a client on file is missing from details given later, never
 * replacing what is there: a later "Tom" must not overwrite "Tom Reid", nor a
 * stranger's email hers. What they want now (`issue`) is always taken.
 */
export function fillGaps(
  current: { name?: string | null; email?: string | null; company?: string | null; notes?: string | null },
  given: { name?: string | null; email?: string | null; company?: string | null; notes?: string | null; issue?: string | null }
): Record<string, string> {
  const out: Record<string, string> = {};
  if (given.name?.trim() && !current.name?.trim()) out.name = given.name.trim();
  if (given.email?.trim() && !current.email?.trim()) out.email = given.email.trim().toLowerCase();
  if (given.company?.trim() && !current.company?.trim()) out.company = given.company.trim();
  if (given.notes?.trim() && "notes" in current && !current.notes?.trim()) out.notes = given.notes.trim();
  if (given.issue?.trim()) out.issue = given.issue.trim().slice(0, 500);
  return out;
}
