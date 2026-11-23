/**
 * A salon's nail technicians, by permanent id.
 *
 * Bookings, blocked time, callbacks and rebook texts used to point at a
 * technician by her name, as text. Renaming her ("Lan" to "Lan Nguyen") cut
 * her off from all of them: the diary's clash check matched the new name,
 * found nothing, and let every channel book her twice. Now each technician
 * is a Technician row with an id, her entry in OrganizationSettings
 * .teamMembers carries the same id, and those rows carry `technicianId`.
 *
 * The name stays on those rows too (stylistName, assignedTo, stylist), as the
 * label every screen and text shows. A rename changes it everywhere in the
 * same transaction as the rename itself (syncTeam), so it is always her
 * current name. Removing her archives her: her history keeps her name.
 *
 * Matching (clashes, busy times, blocks, takings) is by id, falling back to
 * the name only for a row the backfill has not reached yet (byTechnician).
 */
import { parseStylists, type Stylist } from "./salon-config";
import type { Tx } from "./booking-number";
import type { Prisma, PrismaClient } from "../generated/prisma/client";

// The app's client or a transaction on it. Type-only, so the post-deploy
// script can use this module with a client of its own.
type Db = Tx | typeof import("./prisma")["prisma"];

/** What a callback is assigned to when it is for whoever is free. */
const NOBODY = new Set(["team", "anyone", "everyone", ""]);

function key(name: string): string {
  return name.trim().toLowerCase();
}

/** Two technicians on the team with one name: the diary could not tell them apart. */
export class DuplicateTechnicianName extends Error {
  constructor(readonly name: string) {
    super(`Two nail technicians are called "${name}". Give one of them a different name.`);
  }
}

/** A rename, for the caller to report. */
export interface Renamed {
  id: string;
  from: string;
  to: string;
}

/**
 * Where-clause for rows belonging to a technician: hers by id, and any not yet
 * given an id that carry her name. `field` is the name column on that model.
 */
export function byTechnician(
  technicianId: string | null,
  name: string,
  field: "stylistName" | "assignedTo" | "stylist" = "stylistName"
): Record<string, unknown> {
  const named = { [field]: { equals: name.trim(), mode: "insensitive" as const } };
  if (!technicianId) return named;
  return { OR: [{ technicianId }, { technicianId: null, ...named }] };
}

/**
 * The id of the technician on the team called `name`, or null (nobody, "Team",
 * or no such technician yet). Null is safe: a row written without an id is
 * matched by its name (byTechnician) until the post-deploy backfill links it.
 * Nothing is created here: two requests at once could each make her, and
 * split her bookings between two ids.
 */
export async function technicianIdFor(
  db: Db,
  organizationId: string,
  name: string | null | undefined
): Promise<string | null> {
  const n = name?.trim() ?? "";
  if (NOBODY.has(n.toLowerCase())) return null;
  const found = await db.technician.findFirst({
    where: { organizationId, archivedAt: null, name: { equals: n, mode: "insensitive" } },
    select: { id: true },
  });
  return found?.id ?? null;
}

/** `{ technicianId }` for a write carrying this name, for spreading into `data`. */
export async function technicianFields(
  db: Db,
  organizationId: string,
  name: string | null | undefined
): Promise<{ technicianId: string | null }> {
  return { technicianId: await technicianIdFor(db, organizationId, name) };
}

/**
 * Bring the Technician rows in line with a team list about to be saved, and
 * give every entry its id. Returns the list to save.
 *
 * - An entry with an id is that technician: a new name is a rename, written
 *   onto her bookings, blocks, callbacks and rebook texts as well.
 * - An entry without one (a new row in the editor, or a list from before ids)
 *   is the technician of that name on the team, or one archived under that
 *   name (brought back, with her history), or someone new.
 * - A technician on the team but not in the list is archived.
 *
 * Refuses two entries with one name: nothing could tell them apart.
 */
export async function syncTeam(
  db: Db,
  organizationId: string,
  incoming: Stylist[]
): Promise<{ team: Stylist[]; renamed: Renamed[]; archived: string[] }> {
  const seen = new Set<string>();
  for (const s of incoming) {
    const k = key(s.name);
    if (seen.has(k)) throw new DuplicateTechnicianName(s.name.trim());
    seen.add(k);
  }

  const rows = await db.technician.findMany({
    where: { organizationId },
    select: { id: true, name: true, archivedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const used = new Set<string>();
  const renamed: Renamed[] = [];
  const team: Stylist[] = [];

  for (const entry of incoming) {
    const name = entry.name.trim();
    let row = entry.id ? byId.get(entry.id) : undefined;
    if (row && used.has(row.id)) row = undefined;
    if (!row) {
      // Not known by id: the one on the team with this name, else one who left
      // under it, else nobody yet.
      row =
        rows.find((r) => !used.has(r.id) && !r.archivedAt && key(r.name) === key(name)) ??
        rows.find((r) => !used.has(r.id) && r.archivedAt && key(r.name) === key(name));
    }
    if (!row) {
      const created = await db.technician.create({ data: { organizationId, name }, select: { id: true, name: true, archivedAt: true } });
      row = created;
    } else {
      const was = row.name;
      if (row.archivedAt || was !== name) {
        await db.technician.update({ where: { id: row.id }, data: { name, archivedAt: null } });
      }
      if (was !== name) renamed.push({ id: row.id, from: was, to: name });
    }
    used.add(row.id);
    team.push({ ...entry, id: row.id, name });
  }

  const archived: string[] = [];
  for (const r of rows) {
    if (!r.archivedAt && !used.has(r.id)) {
      await db.technician.update({ where: { id: r.id }, data: { archivedAt: new Date() } });
      archived.push(r.id);
    }
  }

  for (const r of renamed) await relabel(db, organizationId, r);
  return { team, renamed, archived };
}

/** Her new name on everything of hers, and her id on anything still carrying only the old name. */
async function relabel(db: Db, organizationId: string, r: Renamed) {
  const hers = (field: "stylistName" | "assignedTo" | "stylist") => ({
    organizationId,
    ...byTechnician(r.id, r.from, field),
  });
  await db.appointment.updateMany({ where: hers("stylistName"), data: { technicianId: r.id, stylistName: r.to } });
  await db.timeBlock.updateMany({ where: hers("stylistName"), data: { technicianId: r.id, stylistName: r.to } });
  await db.callback.updateMany({ where: hers("assignedTo"), data: { technicianId: r.id, assignedTo: r.to } });
  await db.rebookText.updateMany({ where: hers("stylist"), data: { technicianId: r.id, stylist: r.to } });
}

/**
 * Sync the team as saved in settings, writing the ids back onto it: the
 * post-deploy backfill, one salon at a time.
 */
export async function syncSavedTeam(db: Db, organizationId: string): Promise<void> {
  const settings = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { teamMembers: true },
  });
  if (!settings) return;
  const saved = parseStylists(settings.teamMembers);
  const { team } = await syncTeam(db, organizationId, saved);
  const changed = team.some((t, i) => t.id !== saved[i]?.id || t.name !== saved[i]?.name);
  if (changed) {
    await db.organizationSettings.update({
      where: { organizationId },
      data: { teamMembers: team as unknown as Prisma.InputJsonValue },
    });
  }
}

/**
 * Give every row without a technician id the id of the technician its name
 * belongs to: the one on the team, else one archived under that name, else a
 * new archived one (someone who left before ids), so history keeps her name
 * and stays hers. Safe to run any number of times.
 */
export async function linkByName(db: Db, organizationId: string): Promise<number> {
  const names = new Set<string>();
  const collect = (rows: Array<{ n: string | null }>) =>
    rows.forEach((r) => r.n && !NOBODY.has(key(r.n)) && names.add(r.n.trim()));
  collect(
    (await db.appointment.findMany({ where: { organizationId, technicianId: null }, select: { stylistName: true }, distinct: ["stylistName"] })).map((r) => ({ n: r.stylistName }))
  );
  collect(
    (await db.timeBlock.findMany({ where: { organizationId, technicianId: null, stylistName: { not: null } }, select: { stylistName: true }, distinct: ["stylistName"] })).map((r) => ({ n: r.stylistName }))
  );
  collect(
    (await db.callback.findMany({ where: { organizationId, technicianId: null }, select: { assignedTo: true }, distinct: ["assignedTo"] })).map((r) => ({ n: r.assignedTo }))
  );
  collect(
    (await db.rebookText.findMany({ where: { organizationId, technicianId: null, stylist: { not: null } }, select: { stylist: true }, distinct: ["stylist"] })).map((r) => ({ n: r.stylist }))
  );
  if (names.size === 0) return 0;

  const rows = await db.technician.findMany({ where: { organizationId }, select: { id: true, name: true, archivedAt: true } });
  const idFor = new Map<string, string>();
  for (const r of rows.filter((r) => r.archivedAt)) idFor.set(key(r.name), r.id);
  for (const r of rows.filter((r) => !r.archivedAt)) idFor.set(key(r.name), r.id);

  let linked = 0;
  const done = new Set<string>();
  for (const name of names) {
    const k = key(name);
    if (done.has(k)) continue;
    done.add(k);
    let id = idFor.get(k);
    if (!id) {
      id = (await db.technician.create({ data: { organizationId, name, archivedAt: new Date() }, select: { id: true } })).id;
      idFor.set(k, id);
    }
    const named = (field: "stylistName" | "assignedTo" | "stylist") => ({
      organizationId,
      technicianId: null,
      [field]: { equals: name, mode: "insensitive" as const },
    });
    linked += (await db.appointment.updateMany({ where: named("stylistName"), data: { technicianId: id } })).count;
    linked += (await db.timeBlock.updateMany({ where: named("stylistName"), data: { technicianId: id } })).count;
    linked += (await db.callback.updateMany({ where: named("assignedTo"), data: { technicianId: id } })).count;
    linked += (await db.rebookText.updateMany({ where: named("stylist"), data: { technicianId: id } })).count;
  }
  return linked;
}

/**
 * The post-deploy backfill: every salon's team synced and its rows linked.
 * Safe to run any number of times.
 */
export async function backfillTechnicians(client: PrismaClient): Promise<{ salons: number; linked: number }> {
  // The script's own client: the same models, without the app's extensions.
  const db = client as unknown as typeof import("./prisma")["prisma"];
  const salons = await db.organizationSettings.findMany({ select: { organizationId: true } });
  let linked = 0;
  for (const { organizationId } of salons) {
    linked += await db.$transaction(async (tx) => {
      await syncSavedTeam(tx, organizationId);
      return linkByName(tx, organizationId);
    });
  }
  return { salons: salons.length, linked };
}
