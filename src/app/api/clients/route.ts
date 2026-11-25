/**
 * The salon's clients, as the desk sees them: search, sort (by name, number,
 * email, last visit or next booking), add.
 *
 * Separate from /api/leads on purpose. That endpoint serves the inbox and
 * drags in each lead's latest WhatsApp and social conversation; the diary
 * needs names, numbers and visit history, a page at a time, fast enough to
 * run on every keystroke once DaySmart's few thousand clients are imported.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { requireTenant, isErrorResponse } from "@/lib/tenant";
import { parsePagination } from "@/lib/pagination";
import { joinName, parseClientQuery } from "@/lib/client-name";
import { normalisePhone } from "@/lib/phone";
import { nameKey, sameNameCounts } from "@/lib/client-link";
import { patchTestDay } from "@/lib/patch-test";
import { getSalonConfig } from "@/lib/booking";
import { dueBackLeadIds, summaryJson, visitSummaries } from "@/lib/client-summary";

const SORTABLE = ["firstName", "lastName", "phone", "email", "lastVisit", "nextBooking"] as const;
type SortKey = (typeof SORTABLE)[number];

/** Statuses that mean the client actually came in (or was due to). */
const VISITED = ["booked", "completed"];

const CLIENT_FIELDS = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  notes: true,
  // So the booking form knows a colour needs no new test.
  patchTestAt: true,
  // Set for a client with no number of their own, reached through another
  // client's (a child booked on a parent's phone).
  contactLead: { select: { id: true, name: true, phone: true } },
  // Made from typed details another client has: possibly them, for the
  // desk to merge or clear (client-identity.ts, api/clients/[id]/duplicate).
  possibleDuplicateOf: { select: { id: true, name: true, phone: true } },
} as const;

/** A LIKE pattern matching `text` literally, so "%" typed is not a wildcard. */
function literal(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

/**
 * The search box as SQL.
 *
 * Raw rather than a Prisma `where` because of the ordering below: sorting has
 * to ignore case ("de Souza" among the Ds), and Prisma can only order by a
 * column as stored, which under a C collation puts every lower-case surname
 * after Z. The search and the ordering then belong in the same statement.
 */
function searchSql(q: string | null): Prisma.Sql {
  const query = parseClientQuery(q);
  switch (query.kind) {
    case "all":
      return Prisma.sql`TRUE`;
    case "phone":
      // A number also finds the clients reached through it: searching the
      // mum's number finds her daughter too.
      return Prisma.sql`(
        phone LIKE ${`%${literal(query.digits)}%`}
        OR "contactLeadId" IN (
          SELECT c.id FROM ca_leads c WHERE c.phone LIKE ${`%${literal(query.digits)}%`}
        )
      )`;
    case "email":
      return Prisma.sql`email ILIKE ${`%${literal(query.text)}%`}`;
    case "name": {
      const first = `${literal(query.first)}%`;
      if (query.rest === null) {
        return Prisma.sql`(
          "firstName" ILIKE ${first}
          OR "lastName" ILIKE ${first}
          -- A later word of a surname: "souza" finds "Jo de Souza".
          OR "lastName" ILIKE ${`% ${literal(query.first)}%`}
        )`;
      }
      return Prisma.sql`(
        ("firstName" ILIKE ${first} AND "lastName" ILIKE ${`${literal(query.rest)}%`})
        -- Typed as it is written, for names the first-space split gets
        -- wrong: "mary ann" still finds Mary Ann Smith.
        OR name ILIKE ${`${literal(query.whole)}%`}
      )`;
    }
  }
}

/** The Clients page's groups: who needs the salon's attention. */
const GROUPS = ["due", "new", "lapsed", "patch", "duplicates"] as const;
type Group = (typeof GROUPS)[number];
/** "New": first on the books within this many days. */
const NEW_DAYS = 60;
/** "Haven't been in": nothing past or booked for this long. */
const LAPSED_DAYS = 90;

/** A group as SQL on ca_leads. `due` is worked out beforehand (client-summary). */
function groupSql(group: Group | null, organizationId: string, now: Date, dueIds: string[]): Prisma.Sql {
  switch (group) {
    case null:
      return Prisma.sql`TRUE`;
    case "due":
      return dueIds.length ? Prisma.sql`id IN (${Prisma.join(dueIds)})` : Prisma.sql`FALSE`;
    case "new":
      return Prisma.sql`"createdAt" >= ${new Date(now.getTime() - NEW_DAYS * 86_400_000)}`;
    case "lapsed":
      return Prisma.sql`(
        EXISTS (
          SELECT 1 FROM ca_appointments a
          WHERE a."leadId" = ca_leads.id AND a."organizationId" = ${organizationId}
            AND a.status IN (${Prisma.join(VISITED)}) AND a."startsAt" < ${now}
        )
        AND NOT EXISTS (
          SELECT 1 FROM ca_appointments a
          WHERE a."leadId" = ca_leads.id AND a."organizationId" = ${organizationId}
            AND a.status IN (${Prisma.join(VISITED)})
            AND a."startsAt" >= ${new Date(now.getTime() - LAPSED_DAYS * 86_400_000)}
        )
      )`;
    case "duplicates":
      // Made from typed details another client has (client-identity.ts).
      return Prisma.sql`"possibleDuplicateOfId" IS NOT NULL`;
    case "patch":
      // Booked for something that needs a skin test, with none on record.
      return Prisma.sql`(
        "patchTestAt" IS NULL AND EXISTS (
          SELECT 1 FROM ca_appointments a
          WHERE a."leadId" = ca_leads.id AND a."organizationId" = ${organizationId}
            AND a.status = 'booked' AND a."startsAt" >= ${now} AND a."patchTestRequired" = TRUE
        )
      )`;
  }
}

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const { searchParams } = new URL(req.url);
    const { take, skip } = parsePagination(searchParams);
    const sortParam = searchParams.get("sort");
    const sort: SortKey = SORTABLE.includes(sortParam as SortKey)
      ? (sortParam as SortKey)
      : "firstName";
    const dir = searchParams.get("dir") === "desc" ? "DESC" : "ASC";

    // A walk-in booked with no details is a lead with nothing on it. It
    // belongs to its appointment, not in a list someone picks clients from,
    // where it would be a blank row nobody can tell apart.
    const now = new Date();
    const groupParam = searchParams.get("group");
    const group: Group | null = GROUPS.includes(groupParam as Group) ? (groupParam as Group) : null;
    const wantCounts = searchParams.get("counts") === "1";
    const detail = searchParams.get("detail") === "1";
    const cfg = group === "due" || wantCounts || detail ? await getSalonConfig(ctx.organizationId) : null;
    const dueIds = cfg && (group === "due" || wantCounts) ? await dueBackLeadIds(ctx.organizationId, cfg, now) : [];

    const base = Prisma.sql`
      "organizationId" = ${ctx.organizationId}
      AND "anonymisedAt" IS NULL
      AND (name IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL)
      -- Not the made-up clients an Instagram or Messenger message once made
      -- (src/lib/social-client.ts): someone who only messaged is not a client.
      AND (phone IS NULL OR phone !~ '^(instagram|facebook)-')
    `;
    const where = Prisma.sql`
      ${base}
      AND ${groupSql(group, ctx.organizationId, now, dueIds)}
      AND ${searchSql(searchParams.get("q"))}
    `;

    // Column names come from the whitelist above, never from the request.
    // The two visit dates are worked out per client from their appointments,
    // exactly as the rows below report them, so the order matches what shows.
    const col =
      sort === "lastVisit"
        ? Prisma.sql`(
            SELECT max(a."startsAt") FROM ca_appointments a
            WHERE a."leadId" = ca_leads.id AND a."organizationId" = ${ctx.organizationId}
              AND a.status IN (${Prisma.join(VISITED)}) AND a."startsAt" < ${now}
          )`
        : sort === "nextBooking"
          ? Prisma.sql`(
              SELECT min(a."startsAt") FROM ca_appointments a
              WHERE a."leadId" = ca_leads.id AND a."organizationId" = ${ctx.organizationId}
                AND a.status = 'booked' AND a."startsAt" >= ${now}
            )`
          : Prisma.raw(`lower("${sort}")`);
    // Ties broken by the other half of the name, then id, so paging through
    // a salon with six Sarahs neither repeats nor skips one.
    const tie = Prisma.raw(
      sort === "lastName" ? `lower("firstName")` : `lower("lastName")`
    );

    const [page, counted] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM ca_leads
        WHERE ${where}
        ORDER BY ${col} ${Prisma.raw(dir)} NULLS LAST, ${tie} ASC NULLS LAST, id ASC
        LIMIT ${take} OFFSET ${skip}
      `,
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM ca_leads WHERE ${where}
      `,
    ]);
    const total = Number(counted[0]?.count ?? 0);

    const ids = page.map((r) => r.id);
    const found = ids.length
      ? await prisma.lead.findMany({
          where: { id: { in: ids }, organizationId: ctx.organizationId },
          select: CLIENT_FIELDS,
        })
      : [];
    const byId = new Map(found.map((r) => [r.id, r]));
    const rows = ids.flatMap((id) => byId.get(id) ?? []);

    const [past, upcoming] = ids.length
      ? await Promise.all([
          prisma.appointment.groupBy({
            by: ["leadId"],
            where: {
              organizationId: ctx.organizationId,
              leadId: { in: ids },
              status: { in: VISITED },
              startsAt: { lt: now },
            },
            _max: { startsAt: true },
            _count: { _all: true },
          }),
          prisma.appointment.groupBy({
            by: ["leadId"],
            where: {
              organizationId: ctx.organizationId,
              leadId: { in: ids },
              status: "booked",
              startsAt: { gte: now },
            },
            _min: { startsAt: true },
          }),
        ])
      : [[], []];

    const pastBy = new Map(past.map((p) => [p.leadId, p]));
    const nextBy = new Map(upcoming.map((u) => [u.leadId, u._min.startsAt]));
    const sameName = await sameNameCounts(ctx.organizationId, rows.map((r) => r.name));

    const clients = rows.map((r) => ({
      ...r,
      patchTestAt: patchTestDay(r.patchTestAt),
      lastVisit: pastBy.get(r.id)?._max.startsAt ?? null,
      visits: pastBy.get(r.id)?._count._all ?? 0,
      nextBooking: nextBy.get(r.id) ?? null,
      possibleDuplicates: sameName.get(nameKey(r.name) ?? "") ?? 0,
    }));

    // The Clients page: what they usually have, when due back, and so on.
    const summaries = detail && cfg ? await visitSummaries(ctx.organizationId, ids, now, cfg) : null;
    const withDetail = summaries
      ? clients.map((c) => {
          const sm = summaries.get(c.id);
          return { ...c, summary: sm ? summaryJson(sm) : null };
        })
      : clients;

    // How many are in each group, for the page's chips (whatever is searched).
    let counts: Record<string, number> | undefined;
    if (wantCounts) {
      const n = async (g: Group | null) => {
        const r = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM ca_leads WHERE ${base} AND ${groupSql(g, ctx.organizationId, now, dueIds)}
        `;
        return Number(r[0]?.count ?? 0);
      };
      const [all, ...each] = await Promise.all([n(null), ...GROUPS.map((g) => n(g))]);
      counts = { all, ...Object.fromEntries(GROUPS.map((g, i) => [g, each[i]])) };
    }

    return NextResponse.json({ clients: withDetail, total, limit: take, offset: skip, ...(counts ? { counts } : {}) });
  } catch (error) {
    console.error("[CLIENTS API] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v || null;
}

/**
 * Add a client at the desk.
 *
 * A number that is already on the books is not a new client: the salon gets
 * the existing record back with a 409, so the screen can offer to book them
 * rather than creating a duplicate the voice agent would then have to choose
 * between. Unless it is someone else reached through that number (a child on
 * a parent's phone): with `contactThrough`, they are added with no number of
 * their own, linked to the number's owner.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { members: true });
  if (isErrorResponse(ctx)) return ctx;

  try {
    const body = await req.json().catch(() => ({}));
    const firstName = clean(body?.firstName);
    const lastName = clean(body?.lastName);
    const email = clean(body?.email)?.toLowerCase() ?? null;
    const notes = clean(body?.notes);

    if (!firstName) {
      return NextResponse.json({ error: "A first name is needed." }, { status: 400 });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "That email address does not look right." },
        { status: 400 }
      );
    }

    let phone: string | null = null;
    const rawPhone = clean(body?.phone);
    if (rawPhone) {
      const parsed = normalisePhone(rawPhone);
      if (!parsed.ok) {
        return NextResponse.json(
          { error: `That number does not look right: ${parsed.reason}` },
          { status: 400 }
        );
      }
      phone = parsed.e164;
    }

    const existing = await prisma.lead.findFirst({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      select: CLIENT_FIELDS,
    });
    if (body?.contactThrough === true && phone && existing?.phone === phone) {
      const client = await prisma.lead.create({
        data: {
          organizationId: ctx.organizationId,
          firstName,
          lastName,
          name: joinName(firstName, lastName),
          email,
          notes,
          source: "manual",
          contactLeadId: existing.id,
        },
        select: CLIENT_FIELDS,
      });
      return NextResponse.json(
        { client: { ...client, lastVisit: null, visits: 0, nextBooking: null, possibleDuplicates: 0 } },
        { status: 201 }
      );
    }

    if ((phone || email) && existing) {
      return NextResponse.json(
        {
          error: `${existing.name ?? "A client"} already has that ${
            phone && existing.phone === phone ? "number" : "email"
          }.`,
          // A number clash may be a family sharing a phone, which the desk
          // can resolve by adding them reached through it (contactThrough).
          matched: phone && existing.phone === phone ? "phone" : "email",
          existing,
        },
        { status: 409 }
      );
    }

    const client = await prisma.lead.create({
      data: {
        organizationId: ctx.organizationId,
        firstName,
        lastName,
        name: joinName(firstName, lastName),
        phone,
        email,
        notes,
        source: "manual",
      },
      select: CLIENT_FIELDS,
    });

    return NextResponse.json(
      { client: { ...client, lastVisit: null, visits: 0, nextBooking: null, possibleDuplicates: 0 } },
      { status: 201 }
    );
  } catch (error) {
    console.error("[CLIENTS API] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
