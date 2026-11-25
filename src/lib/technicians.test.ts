import { beforeEach, describe, expect, it } from "vitest";
import { isStaleTeamList, linkByName, loadTeam, syncSavedTeam, syncTeam, DuplicateTechnicianName } from "./technicians";
import { isTechnicians, blocksTechnician } from "./technician-match";
import { blockApplies } from "./time-blocks";

/**
 * Technicians by permanent id: a rename moves her bookings, blocks, callbacks
 * and rebook texts with her; taking her off the team archives her; a list from
 * before ids finds everyone by name. The database is an in-memory stand-in that
 * understands the few where-clauses these functions write.
 */

type Row = Record<string, unknown> & { id: string };
let seq = 0;
const tables: Record<string, Row[]> = {};

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Record<string, unknown>[]).some((w) => matches(row, w));
    const cell = row[k];
    if (v === null) return cell === null || cell === undefined;
    if (v && typeof v === "object") {
      const o = v as { equals?: string; mode?: string; not?: unknown };
      if ("equals" in o) return typeof cell === "string" && cell.toLowerCase() === String(o.equals).toLowerCase();
      if ("not" in o) return o.not === null ? cell !== null && cell !== undefined : cell !== o.not;
    }
    return cell === v;
  });
}

function table(name: string) {
  tables[name] ??= [];
  const rows = () => tables[name];
  return {
    findMany: async ({
      where = {},
      distinct,
      orderBy,
    }: { where?: Record<string, unknown>; distinct?: string[]; orderBy?: Record<string, string> | Record<string, string>[] } = {}) => {
      const found = rows().filter((r) => matches(r, where));
      const by = [orderBy ?? []].flat().map((o) => Object.keys(o)[0]).filter((k) => k !== "createdAt");
      found.sort((x, y) => by.map((k) => Number(x[k] ?? 0) - Number(y[k] ?? 0)).find((d) => d !== 0) ?? 0);
      if (!distinct) return found;
      const seen = new Set<string>();
      return found.filter((r) => {
        const k = distinct.map((d) => String(r[d])).join("|");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows().find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where: Record<string, unknown> }) => rows().find((r) => matches(r, where)) ?? null,
    count: async ({ where }: { where: Record<string, unknown> }) => rows().filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `${name}-${++seq}`, archivedAt: null, ...data } as Row;
      rows().push(row);
      return row;
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows().find((r) => matches(r, where))!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows().filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
}

const fake = {
  technician: table("technician"),
  appointment: table("appointment"),
  timeBlock: table("timeBlock"),
  callback: table("callback"),
  rebookText: table("rebookText"),
  organizationSettings: table("organizationSettings"),
};
const db = fake as unknown as Parameters<typeof syncTeam>[0];

const ORG = "org";
const team = (...names: string[]) => names.map((name) => ({ name, workingDays: [], services: [] }));
const techs = () => tables.technician.filter((t) => t.organizationId === ORG);

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k].length = 0;
});

describe("syncTeam", () => {
  it("gives each technician a permanent id, and keeps it on the next save", async () => {
    const first = await syncTeam(db, ORG, team("Mai", "Lan"));
    expect(first.team.map((t) => t.id)).toEqual(techs().map((t) => t.id));
    const again = await syncTeam(db, ORG, first.team);
    expect(again.team.map((t) => t.id)).toEqual(first.team.map((t) => t.id));
    expect(techs()).toHaveLength(2);
  });

  it("finds everyone by name in a list from before ids, rather than making them twice", async () => {
    const first = await syncTeam(db, ORG, team("Mai", "Lan"));
    const again = await syncTeam(db, ORG, team("lan", "Mai"));
    expect(again.team.map((t) => t.id)).toEqual([first.team[1].id, first.team[0].id]);
  });

  it("moves her bookings, blocks, callbacks and rebook texts with her on a rename", async () => {
    const { team: saved } = await syncTeam(db, ORG, team("Mai", "Lan"));
    const lan = saved[1].id!;
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "Lan", technicianId: lan } });
    // Written before ids: only her name.
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "lan", technicianId: null } });
    await fake.timeBlock.create({ data: { organizationId: ORG, stylistName: "Lan", technicianId: lan } });
    await fake.callback.create({ data: { organizationId: ORG, assignedTo: "Lan", technicianId: lan } });
    await fake.rebookText.create({ data: { organizationId: ORG, stylist: "Lan", technicianId: lan } });
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "Mai", technicianId: saved[0].id } });

    const r = await syncTeam(db, ORG, [saved[0], { ...saved[1], name: "Lan Nguyen" }]);
    expect(r.renamed).toEqual([{ id: lan, from: "Lan", to: "Lan Nguyen" }]);
    expect(tables.appointment.filter((a) => a.technicianId === lan).map((a) => a.stylistName)).toEqual(["Lan Nguyen", "Lan Nguyen"]);
    expect(tables.timeBlock[0]).toMatchObject({ stylistName: "Lan Nguyen", technicianId: lan });
    expect(tables.callback[0]).toMatchObject({ assignedTo: "Lan Nguyen", technicianId: lan });
    expect(tables.rebookText[0]).toMatchObject({ stylist: "Lan Nguyen", technicianId: lan });
    expect(tables.appointment.find((a) => a.stylistName === "Mai")).toBeDefined();
  });

  it("archives someone taken off the team, keeping her name on her history", async () => {
    const { team: saved } = await syncTeam(db, ORG, team("Mai", "Lan"));
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "Lan", technicianId: saved[1].id } });
    const r = await syncTeam(db, ORG, [saved[0]]);
    expect(r.archived).toEqual([saved[1].id]);
    expect(techs().find((t) => t.id === saved[1].id)).toMatchObject({ name: "Lan", archivedAt: expect.any(Date) });
    expect(tables.appointment[0]).toMatchObject({ stylistName: "Lan", technicianId: saved[1].id });
  });

  it("brings back someone re-added under her old name, with her history", async () => {
    const { team: saved } = await syncTeam(db, ORG, team("Mai", "Lan"));
    await syncTeam(db, ORG, [saved[0]]);
    const back = await syncTeam(db, ORG, [saved[0], ...team("Lan")]);
    expect(back.team[1].id).toBe(saved[1].id);
    expect(techs().find((t) => t.id === saved[1].id)!.archivedAt).toBeNull();
  });

  it("keeps everyone's id when one is renamed and someone new takes her old name, whatever the order", async () => {
    const { team: saved } = await syncTeam(db, ORG, team("Mai", "Lan"));
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "Lan", technicianId: saved[1].id } });
    // The new Lan above the old one, renamed in the same save.
    const r = await syncTeam(db, ORG, [saved[0], ...team("Lan"), { ...saved[1], name: "Lan Nguyen" }]);
    expect(r.team[2].id).toBe(saved[1].id);
    expect(r.team[1].id).not.toBe(saved[1].id);
    expect(tables.appointment[0]).toMatchObject({ stylistName: "Lan Nguyen", technicianId: saved[1].id });
  });

  it("keeps all she is on her record, in the team's order", async () => {
    await syncTeam(db, ORG, [
      { name: "Mai", role: " Owner ", phone: "07700 900111", workingDays: [1, 2], services: ["BIAB"], googleCalendarId: "mai@cal" },
      { name: "Kim", takesBookings: false, workingDays: [], services: [] },
    ]);
    expect(techs()[0]).toMatchObject({ role: "Owner", phone: "07700 900111", workingDays: [1, 2], services: ["BIAB"], googleCalendarId: "mai@cal", sortOrder: 0, takesBookings: true });
    expect(techs()[1]).toMatchObject({ takesBookings: false, sortOrder: 1, role: null });
  });

  it("reads the team back from the records, without anyone who left", async () => {
    expect(await loadTeam(db, ORG)).toBeNull();
    const { team: saved } = await syncTeam(db, ORG, [...team("Mai", "Lan"), { name: "Kim", takesBookings: false, workingDays: [], services: [] }]);
    await syncTeam(db, ORG, [saved[2], saved[0]]);
    const loaded = await loadTeam(db, ORG);
    expect(loaded!.map((t) => [t.name, t.id])).toEqual([["Kim", saved[2].id], ["Mai", saved[0].id]]);
    expect(loaded![0].takesBookings).toBe(false);
    expect(loaded![1]).not.toHaveProperty("takesBookings");
  });

  it("calls a list without ids stale once the salon's technicians have them", async () => {
    expect(await isStaleTeamList(db, ORG, team("Mai"))).toBe(false);
    const { team: saved } = await syncTeam(db, ORG, team("Mai"));
    expect(await isStaleTeamList(db, ORG, team("Mai"))).toBe(true);
    expect(await isStaleTeamList(db, ORG, [saved[0], ...team("Lan")])).toBe(false);
    expect(await isStaleTeamList(db, ORG, [])).toBe(false);
  });

  it("refuses two technicians with one name", async () => {
    await expect(syncTeam(db, ORG, team("Lan", "lan "))).rejects.toBeInstanceOf(DuplicateTechnicianName);
  });
});

describe("syncSavedTeam (the backfill)", () => {
  it("fills her details onto a record made before they were kept, and changes nothing the second time", async () => {
    await fake.technician.create({ data: { organizationId: ORG, name: "Thảo" } });
    const id = techs()[0].id;
    await fake.organizationSettings.create({
      data: { organizationId: ORG, teamMembers: [{ id, name: "Thảo", role: "Owner", workingDays: [3, 4], services: [] }] },
    });
    await syncSavedTeam(db, ORG);
    await syncSavedTeam(db, ORG);
    expect(techs()).toHaveLength(1);
    expect(techs()[0]).toMatchObject({ id, role: "Owner", workingDays: [3, 4], archivedAt: null });
  });

  it("never archives everyone because the saved list is empty", async () => {
    await syncTeam(db, ORG, team("Mai"));
    await fake.organizationSettings.create({ data: { organizationId: ORG, teamMembers: [] } });
    await syncSavedTeam(db, ORG);
    expect(techs()[0].archivedAt).toBeNull();
  });
});

describe("linkByName (the backfill)", () => {
  it("points old rows at the technician of that name, and someone who left at an archived one", async () => {
    const { team: saved } = await syncTeam(db, ORG, team("Mai"));
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "mai", technicianId: null } });
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "Jo", technicianId: null } });
    await fake.callback.create({ data: { organizationId: ORG, assignedTo: "Team", technicianId: null } });
    await fake.timeBlock.create({ data: { organizationId: ORG, stylistName: null, technicianId: null } });

    expect(await linkByName(db, ORG)).toBe(2);
    expect(tables.appointment[0].technicianId).toBe(saved[0].id);
    const jo = techs().find((t) => t.name === "Jo")!;
    expect(jo.archivedAt).toEqual(expect.any(Date));
    expect(tables.appointment[1].technicianId).toBe(jo.id);
    // "Team" and a block for the whole salon stay for nobody.
    expect(tables.callback[0].technicianId).toBeNull();
    expect(tables.timeBlock[0].technicianId).toBeNull();
    expect(await linkByName(db, ORG)).toBe(0);
  });

  it("links a callback to someone known, but never makes a technician out of what a caller asked for", async () => {
    const { team: saved } = await syncTeam(db, ORG, team("Mai"));
    await fake.callback.create({ data: { organizationId: ORG, assignedTo: "mai", technicianId: null } });
    await fake.callback.create({ data: { organizationId: ORG, assignedTo: "whoever's free", technicianId: null } });
    await fake.rebookText.create({ data: { organizationId: ORG, stylist: "Jo", technicianId: null } });

    expect(await linkByName(db, ORG)).toBe(1);
    expect(tables.callback[0].technicianId).toBe(saved[0].id);
    expect(tables.callback[1].technicianId).toBeNull();
    expect(tables.rebookText[0].technicianId).toBeNull();
    expect(techs()).toHaveLength(1);
  });

  it("links a callback to someone who left, once a booking of hers has made her record", async () => {
    await fake.appointment.create({ data: { organizationId: ORG, stylistName: "Jo", technicianId: null } });
    await fake.callback.create({ data: { organizationId: ORG, assignedTo: "Jo", technicianId: null } });
    expect(await linkByName(db, ORG)).toBe(2);
    expect(tables.callback[0].technicianId).toBe(techs()[0].id);
  });
});

describe("matching a row to a technician", () => {
  it("is by id when both have one, so a new Lan is not the Lan who left", () => {
    expect(isTechnicians({ stylistName: "Lan", technicianId: "old" }, { name: "Lan", id: "new" })).toBe(false);
    expect(isTechnicians({ stylistName: "Lan Nguyen", technicianId: "lan" }, { name: "Lan", id: "lan" })).toBe(true);
    expect(isTechnicians({ stylistName: "lan", technicianId: null }, { name: "Lan", id: "lan" })).toBe(true);
  });

  it("keeps a block for the whole salon on everyone, and hers on her by id", () => {
    expect(blocksTechnician({ stylistName: null }, { name: "Lan", id: "lan" })).toBe(true);
    expect(blockApplies({ stylistName: "Lan", technicianId: "old" }, "Lan", "new")).toBe(false);
    expect(blockApplies({ stylistName: "Lan", technicianId: "lan" }, "Lan Nguyen", "lan")).toBe(true);
  });
});
