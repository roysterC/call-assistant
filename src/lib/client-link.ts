/**
 * Clients on a number, and clients reached through someone else's.
 *
 * A number is not always one person: a mum books herself and her daughter on
 * her own phone. The daughter gets a record of her own — her own history,
 * her own new-or-returning status, her name on the diary — with no number of
 * her own and a link to her mum's (`contactLeadId`). Texts about her bookings
 * go to that number and greet her mum; a call from it can manage them.
 * Several clients may also have the number itself (a couple sharing a
 * phone): its first is who it reaches, and the rest are told apart by name.
 *
 * Every path that writes a booking against a number, or texts a client, or
 * looks bookings up by number, goes through here, so they agree on who is
 * who. Who may be found by a number at all is client-identity.ts's rule: a
 * number the channel proved, or the salon typed. One a caller or visitor
 * only gave finds nobody on file (`proof: "typed"`).
 */

import { prisma } from "@/lib/prisma";
import { namesMatch, splitName } from "@/lib/client-name";
import {
  clientsOnNumber,
  newClientFromTyped,
  withClientLock,
  type Db,
  type Proof,
} from "@/lib/client-identity";

type LeadRow = NonNullable<Awaited<ReturnType<typeof prisma.lead.findUnique>>>;

/** How a number was come by, and the client the conversation is already filed under. */
export interface NumberProof {
  /** "proved" (caller ID, WhatsApp, the desk) unless said otherwise. */
  proof?: Proof;
  /**
   * The client a chat is filed under: who a typed number in it may book as,
   * under their own name. Ignored for a proved number.
   */
  clientId?: string | null;
}

/**
 * The record a booking for `name`, made on `phone`, belongs on.
 *
 * A proved number:
 * - Nobody on it: a new record for them, with it.
 * - Its own client (or a record with no name yet), or another client on it
 *   by that name: theirs, with the name filled in or lengthened ("Sarah"
 *   becoming "Sarah Jones").
 * - Somebody else: the record reached through that number under their name,
 *   or a new one. Never the number holder's record renamed, which is how a
 *   mum's bookings came to show her daughter's name.
 *
 * A typed one: the chat's own client if it is them, else a new record with
 * the number, marked as possibly whoever on file it matches. Never a client
 * on file: anyone can give her number and her name.
 */
export async function clientForBooking(
  organizationId: string,
  phone: string,
  name: string,
  source = "phone",
  how: NumberProof = {}
): Promise<{ lead: LeadRow; contact: LeadRow | null }> {
  return withClientLock(organizationId, phone, async (tx) => {
    if (how.proof === "typed") {
      const own = await chatClient(tx, organizationId, how.clientId, name);
      if (own) return { lead: own, contact: null };
      return { lead: await newClientFromTyped(tx, organizationId, { name, phone, source }), contact: null };
    }

    const on = await clientsOnNumber(tx, organizationId, phone);
    const holder = on[0];
    if (!holder) {
      const lead = await tx.lead.create({ data: { organizationId, phone, name, source } });
      return { lead, contact: null };
    }

    const same = !holder.name?.trim() ? holder : on.find((c) => namesMatch(c.name, name));
    if (same) return { lead: await lengthened(tx, same, name), contact: null };

    const dependents = await tx.lead.findMany({
      where: { organizationId, contactLeadId: holder.id, anonymisedAt: null },
      orderBy: { createdAt: "asc" },
    });
    const known = dependents.find((d) => namesMatch(d.name, name));
    if (known) return { lead: await lengthened(tx, known, name), contact: holder };

    const lead = await tx.lead.create({
      data: { organizationId, name, source, contactLeadId: holder.id },
    });
    return { lead, contact: holder };
  });
}

/**
 * The record a message or callback left on `phone` is filed under. A proved
 * number: its own client, whoever is speaking (a friend ringing about her is
 * written on the note, not made her), or a new one with `name`. A typed one:
 * the chat's own client if it is them, else a new record, marked as possibly
 * whoever on file has the number.
 */
export async function clientForMessage(
  organizationId: string,
  phone: string,
  name: string | null,
  source: string,
  how: NumberProof = {}
): Promise<LeadRow> {
  return withClientLock(organizationId, phone, async (tx) => {
    if (how.proof === "typed") {
      return (
        (await chatClient(tx, organizationId, how.clientId, name)) ??
        (await newClientFromTyped(tx, organizationId, { name, phone, source }))
      );
    }
    const holder = (await clientsOnNumber(tx, organizationId, phone))[0];
    return holder ?? tx.lead.create({ data: { organizationId, phone, name, source } });
  });
}

/** The chat's own client, when the booking is for them (or they have no name yet). */
async function chatClient(db: Db, organizationId: string, clientId: string | null | undefined, name: string | null | undefined) {
  if (!clientId) return null;
  const own = await db.lead.findFirst({ where: { id: clientId, organizationId, anonymisedAt: null } });
  if (!own) return null;
  if (!name?.trim() || !own.name?.trim() || namesMatch(own.name, name)) return own;
  return null;
}

/** The record with `name` written on it if that says more than it has. */
async function lengthened(db: Db, lead: LeadRow, name: string): Promise<LeadRow> {
  return longerName(lead.name, name) ? db.lead.update({ where: { id: lead.id }, data: { name } }) : lead;
}

/**
 * The record clientForBooking would pick for `name` on `phone`, read only:
 * nothing is created or renamed. Null when there is none yet. With no name,
 * the number's own client.
 *
 * For checking what is on file before a booking is made — a patch test, say —
 * so the same person is looked at as the booking will then be written to. A
 * typed number finds only the chat's own client: what is on a stranger's
 * record is not read out to whoever gave her number.
 */
export async function findClientOnNumber(
  organizationId: string,
  phone: string,
  name?: string | null,
  how: NumberProof = {}
): Promise<LeadRow | null> {
  if (how.proof === "typed") return chatClient(prisma, organizationId, how.clientId, name);
  const on = await clientsOnNumber(prisma, organizationId, phone);
  const holder = on[0];
  if (!holder) return null;
  if (!name?.trim() || !holder.name?.trim()) return holder;
  const same = on.find((c) => namesMatch(c.name, name));
  if (same) return same;
  const dependents = await prisma.lead.findMany({
    where: { organizationId, contactLeadId: holder.id, anonymisedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return dependents.find((d) => namesMatch(d.name, name)) ?? null;
}

/**
 * Whether the person a booking is for has been to the salon before, going by
 * the record that booking goes on (findClientOnNumber). Read only.
 *
 * The record has to carry their name, not just the number: a mum's visits
 * never make her daughter, booked on the mum's phone, a returning client
 * (that would skip the daughter's skin test), and a record with no name on it
 * cannot say whose visits they were.
 */
export async function hasBeenBefore(
  organizationId: string,
  phone: string,
  name: string,
  how: NumberProof = {}
): Promise<boolean> {
  const client = await findClientOnNumber(organizationId, phone, name, how);
  if (!client?.name?.trim() || !namesMatch(client.name, name)) return false;
  return hasVisited(client.id);
}

/** A visit that happened: done, or booked for a time now past. */
export async function hasVisited(leadId: string): Promise<boolean> {
  const n = await prisma.appointment.count({
    where: {
      leadId,
      OR: [{ status: "completed" }, { status: "booked", startsAt: { lt: new Date() } }],
    },
  });
  return n > 0;
}

/** Whether `next` says more of the same name than `current` does. */
function longerName(current: string | null, next: string): boolean {
  return (current ?? "").trim().split(/\s+/).filter(Boolean).length < next.trim().split(/\s+/).length;
}

/** The parts of a client record the texts need. */
export interface Textable {
  name: string | null;
  phone: string | null;
  contactLead?: { name: string | null; phone: string | null } | null;
}

/**
 * Where a text about `client`'s booking goes, and whom it greets.
 *
 * Their own number when they have one. Otherwise the number they are reached
 * through, greeting its owner and naming them: "Hi Claire — Amy is booked
 * in…". Null when there is nowhere to send it.
 */
export function textRecipient(
  client: Textable
): { to: string; greet: string | null; forName: string | null } | null {
  if (client.phone) return { to: client.phone, greet: client.name, forName: null };
  const via = client.contactLead;
  if (via?.phone) {
    return { to: via.phone, greet: via.name, forName: splitName(client.name).firstName ?? client.name };
  }
  return null;
}

/**
 * Everyone whose bookings a number can manage: the clients who have it (its
 * own first), and the clients reached through it. Empty when nobody has it.
 * Only ever asked for a proved number (changes.ts).
 */
export async function peopleOnNumber(
  organizationId: string,
  phone: string
): Promise<Array<{ id: string; name: string | null; isHolder: boolean }>> {
  const on = await clientsOnNumber(prisma, organizationId, phone);
  if (on.length === 0) return [];
  const dependents = await prisma.lead.findMany({
    where: { organizationId, contactLeadId: { in: on.map((c) => c.id) }, anonymisedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return [
    ...on.map((c) => ({ id: c.id, name: c.name, isHolder: true })),
    ...dependents.map((d) => ({ ...d, isHolder: false })),
  ];
}

/**
 * How many other clients share each of these names, ignoring case and
 * spacing. Anything above zero is flagged at the desk as a possible duplicate:
 * a daughter booked on her mum's phone who later rings from her own mobile
 * gets a second record, and the desk is the one that can tell.
 *
 * Exact full names only. "Amy" and "Amy Burns" are not flagged against each
 * other; neither are two people who really are both called Sarah Jones and
 * are told apart by their numbers, which the flag shows alongside.
 */
export async function sameNameCounts(
  organizationId: string,
  names: Array<string | null>
): Promise<Map<string, number>> {
  const keys = [...new Set(names.map(nameKey).filter((k): k is string => Boolean(k)))];
  if (keys.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ key: string; count: bigint }>>`
    SELECT lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')) AS key, count(*) AS count
    FROM ca_leads
    WHERE "organizationId" = ${organizationId}
      AND lower(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g')) = ANY(${keys})
    GROUP BY 1
    HAVING count(*) > 1
  `;
  return new Map(rows.map((r) => [r.key, Number(r.count) - 1]));
}

/** The key `sameNameCounts` groups on. */
export function nameKey(name: string | null | undefined): string | null {
  const k = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return k || null;
}
