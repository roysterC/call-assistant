import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving the team from Settings: a page opened before technicians had ids is
 * refused rather than turning a rename into someone new, and the team is
 * written to its records and the saved list in one go. The database is an
 * in-memory stand-in.
 */

type Row = Record<string, unknown> & { id: string };
const db = vi.hoisted(() => ({ technician: [] as Row[], settings: [] as Row[], seq: 0, transactions: [] as unknown[] }));

vi.mock("@/lib/tenant", () => ({
  requireTenant: async () => ({ organizationId: "org", role: "admin", isSuperAdmin: false }),
  isErrorResponse: () => false,
}));

vi.mock("@/lib/prisma", () => {
  const where = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (v === null ? r[k] == null : typeof v === "object" ? true : r[k] === v));
  const technician = {
    findMany: async ({ where: w = {} }: { where?: Record<string, unknown> } = {}) =>
      db.technician.filter((r) => where(r, w)).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)),
    count: async ({ where: w }: { where: Record<string, unknown> }) => db.technician.filter((r) => where(r, w)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const r = { id: `t${++db.seq}`, archivedAt: null, ...data } as Row;
      db.technician.push(r);
      return r;
    },
    update: async ({ where: w, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Object.assign(db.technician.find((r) => r.id === w.id)!, data),
  };
  const none = { updateMany: async () => ({ count: 0 }) };
  const organizationSettings = {
    findUnique: async () => db.settings[0] ?? null,
    upsert: async ({ update, create }: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
      if (db.settings[0]) Object.assign(db.settings[0], update);
      else db.settings.push({ id: "s", ...create });
      return db.settings[0];
    },
  };
  const client = { technician, organizationSettings, appointment: none, timeBlock: none, callback: none, rebookText: none };
  return {
    prisma: {
      ...client,
      $transaction: async (fn: (tx: typeof client) => unknown, opts: unknown) => {
        db.transactions.push(opts);
        return fn(client);
      },
    },
  };
});

import { PUT } from "./route";

const put = (body: unknown) =>
  PUT(new Request("http://x/api/settings", { method: "PUT", body: JSON.stringify(body) }) as never);
const member = (name: string, extra: Record<string, unknown> = {}) => ({ name, workingDays: [], services: [], ...extra });

beforeEach(() => {
  db.technician = [];
  db.settings = [{ id: "s", organizationId: "org", businessHours: null, teamMembers: [] }];
  db.transactions = [];
});

describe("PUT /api/settings, the team", () => {
  it("gives a first team its ids, on its records and the saved list alike", async () => {
    const res = await put({ teamMembers: [member("Mai", { role: "Owner" }), member("Kim", { takesBookings: false })] });
    expect(res.status).toBe(200);
    const saved = (await res.json()).settings.teamMembers;
    expect(saved.map((t: Row) => t.id)).toEqual(db.technician.map((t) => t.id));
    expect(db.technician[0]).toMatchObject({ name: "Mai", role: "Owner", takesBookings: true });
    expect(db.technician[1]).toMatchObject({ name: "Kim", takesBookings: false });
    expect(db.settings[0].teamMembers).toEqual(saved);
    // Longer than the five seconds a rename of a busy technician can need.
    expect(db.transactions[0]).toMatchObject({ timeout: expect.any(Number) });
  });

  it("refuses a list from a page opened before ids, rather than make a renamed technician someone new", async () => {
    await put({ teamMembers: [member("Lan")] });
    const res = await put({ teamMembers: [member("Lan Nguyen")] });
    expect(res.status).toBe(409);
    expect(db.technician).toHaveLength(1);
    expect(db.technician[0].name).toBe("Lan");
  });

  it("renames her on the same record when the page sends her id", async () => {
    const first = (await (await put({ teamMembers: [member("Lan")] })).json()).settings.teamMembers;
    const res = await put({ teamMembers: [{ ...first[0], name: "Lan Nguyen" }] });
    expect(res.status).toBe(200);
    expect(db.technician).toHaveLength(1);
    expect(db.technician[0]).toMatchObject({ id: first[0].id, name: "Lan Nguyen" });
  });

  it("refuses two technicians with one name", async () => {
    const res = await put({ teamMembers: [member("Lan"), member("lan")] });
    expect(res.status).toBe(400);
    expect(db.technician).toHaveLength(0);
  });
});
