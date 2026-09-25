/**
 * The salon's clients, as the desk sees them: search, sort, add.
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

const SORTABLE = ["firstName", "lastName", "phone", "email"] as const;
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
      return Prisma.sql`phone LIKE ${`%${literal(query.digits)}%`}`;
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

/**
 * A stylist's client list is the clients they have had a booking with. In a
 * salon of chair renters, one stylist's clients are not another's to read.
 * The owner (null) sees everyone.
 */
function ownClientsSql(organizationId: string, stylistName: string | null): Prisma.Sql {
  if (stylistName === null) return Prisma.sql`TRUE`;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM ca_appointments ap
    WHERE ap."leadId" = ca_leads.id
      AND ap."organizationId" = ${organizationId}
      AND lower(ap."stylistName") = lower(${stylistName})
  )`;
}

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, { stylists: true });
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
    const where = Prisma.sql`
      "organizationId" = ${ctx.organizationId}
      AND (name IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL)
      AND ${searchSql(searchParams.get("q"))}
      AND ${ownClientsSql(ctx.organizationId, ctx.stylist?.name ?? null)}
    `;

    // Column names come from the whitelist above, never from the request.
    const col = Prisma.raw(`lower("${sort}")`);
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

    const now = new Date();
    // A stylist sees the visits they did, not a colleague's.
    const ownVisits = ctx.stylist
      ? { stylistName: { equals: ctx.stylist.name, mode: "insensitive" as const } }
      : {};
    const [past, upcoming] = ids.length
      ? await Promise.all([
          prisma.appointment.groupBy({
            by: ["leadId"],
            where: {
              organizationId: ctx.organizationId,
              leadId: { in: ids },
              status: { in: VISITED },
              startsAt: { lt: now },
              ...ownVisits,
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
              ...ownVisits,
            },
            _min: { startsAt: true },
          }),
        ])
      : [[], []];

    const pastBy = new Map(past.map((p) => [p.leadId, p]));
    const nextBy = new Map(upcoming.map((u) => [u.leadId, u._min.startsAt]));

    const clients = rows.map((r) => ({
      ...r,
      lastVisit: pastBy.get(r.id)?._max.startsAt ?? null,
      visits: pastBy.get(r.id)?._count._all ?? 0,
      nextBooking: nextBy.get(r.id) ?? null,
    }));

    return NextResponse.json({ clients, total, limit: take, offset: skip });
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
 * between.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, { stylists: true });
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
    if ((phone || email) && existing) {
      return NextResponse.json(
        {
          error: `${existing.name ?? "A client"} already has that ${
            phone && existing.phone === phone ? "number" : "email"
          }.`,
          // A stylist can book them, but not read what another stylist holds
          // on them: the name to confirm it is the right person, and nothing
          // else.
          existing: ctx.stylist
            ? {
                id: existing.id,
                name: existing.name,
                firstName: existing.firstName,
                lastName: existing.lastName,
                phone: null,
                email: null,
                notes: null,
              }
            : existing,
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
      { client: { ...client, lastVisit: null, visits: 0, nextBooking: null } },
      { status: 201 }
    );
  } catch (error) {
    console.error("[CLIENTS API] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
