/**
 * Clients reached through someone else's number.
 *
 * A number belongs to one client record (`Lead` is unique on organisation and
 * phone), but not always to one person: a mum books herself and her daughter
 * on her own phone. The daughter gets a record of her own — her own history,
 * her own new-or-returning status, her name on the diary — with no number of
 * her own and a link to her mum's (`contactLeadId`). Texts about her bookings
 * go to that number and greet her mum; a call from it can manage them.
 *
 * Every path that writes a booking against a number, or texts a client, or
 * looks bookings up by number, goes through here, so the three agree on who
 * is who.
 */

import { prisma } from "@/lib/prisma";
import { namesMatch, splitName } from "@/lib/client-name";

type LeadRow = NonNullable<Awaited<ReturnType<typeof prisma.lead.findUnique>>>;

/**
 * The record a booking for `name`, made on `phone`, belongs on.
 *
 * - Nobody on the number: a new record for them, with it.
 * - The number's own client (or a record with no name yet): theirs, with the
 *   name filled in or lengthened ("Sarah" becoming "Sarah Jones").
 * - Somebody else: the record linked to that number under their name, or a
 *   new one. Never the number holder's record renamed, which is how a mum's
 *   bookings came to show her daughter's name.
 */
export async function clientForBooking(
  organizationId: string,
  phone: string,
  name: string,
  source = "phone"
): Promise<{ lead: LeadRow; contact: LeadRow | null }> {
  const holder = await prisma.lead.findUnique({
    where: { organizationId_phone: { organizationId, phone } },
  });

  if (!holder) {
    const lead = await prisma.lead.create({ data: { organizationId, phone, name, source } });
    return { lead, contact: null };
  }

  if (!holder.name?.trim() || namesMatch(holder.name, name)) {
    const lead = longerName(holder.name, name)
      ? await prisma.lead.update({ where: { id: holder.id }, data: { name } })
      : holder;
    return { lead, contact: null };
  }

  const dependents = await prisma.lead.findMany({
    where: { organizationId, contactLeadId: holder.id },
    orderBy: { createdAt: "asc" },
  });
  const known = dependents.find((d) => namesMatch(d.name, name));
  if (known) {
    const lead = longerName(known.name, name)
      ? await prisma.lead.update({ where: { id: known.id }, data: { name } })
      : known;
    return { lead, contact: holder };
  }

  const lead = await prisma.lead.create({
    data: { organizationId, name, source, contactLeadId: holder.id },
  });
  return { lead, contact: holder };
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
 * Everyone whose bookings a number can manage: its own client, and the
 * clients reached through it. Empty when nobody holds the number.
 */
export async function peopleOnNumber(
  organizationId: string,
  phone: string
): Promise<Array<{ id: string; name: string | null; isHolder: boolean }>> {
  const holder = await prisma.lead.findUnique({
    where: { organizationId_phone: { organizationId, phone } },
    select: { id: true, name: true },
  });
  if (!holder) return [];
  const dependents = await prisma.lead.findMany({
    where: { organizationId, contactLeadId: holder.id },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return [{ ...holder, isHolder: true }, ...dependents.map((d) => ({ ...d, isHolder: false }))];
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
