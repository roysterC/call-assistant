import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; name: string | null; phone: string | null; email: string | null; patchTestAt: Date | null };

const db = vi.hoisted(() => ({ leads: [] as Row[], updates: [] as { id: string; data: Record<string, unknown> }[] }));

vi.mock("@/lib/prisma", () => {
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      k === "id" && v && typeof v === "object" && "not" in v
        ? r.id !== (v as { not: string }).not
        : (r as unknown as Record<string, unknown>)[k] === v
    );
  return {
    prisma: {
      lead: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => db.leads.find((r) => matches(r, where)) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          db.updates.push({ id: where.id, data });
          return { id: where.id };
        },
      },
    },
  };
});
vi.mock("@/lib/booking", () => ({
  getSalonConfig: async () => ({ timeZone: "Europe/London", hours: [], services: [], stylists: [] }),
  getBookingProvider: vi.fn(),
  canCreateBooking: vi.fn(),
  earliestBookableStart: vi.fn(),
}));

import { commitDraft, proposeDetails, type DetailsDraft } from "./drafts";

const asker = { organizationId: "org", role: "admin" as const };
// A Sunday.
const now = new Date("2026-09-13T10:00:00Z");

beforeEach(() => {
  db.updates = [];
  db.leads = [
    { id: "sarah", organizationId: "org", name: "Sarah Jones", phone: "+447700900123", email: "sarah@old.co.uk", patchTestAt: null },
    { id: "jo", organizationId: "org", name: "Jo Bloggs", phone: "+447700900999", email: "jo@x.co.uk", patchTestAt: null },
    { id: "elsewhere", organizationId: "other", name: "Sam", phone: "+447700900555", email: null, patchTestAt: null },
  ];
});

async function card(req: Parameters<typeof proposeDetails>[1]) {
  const p = await proposeDetails(asker, req, now);
  if (!p.ok) throw new Error(p.message);
  return p.draft as DetailsDraft;
}

describe("changing a client's details by voice", () => {
  it("shows the old value beside the new, in the forms people read", async () => {
    const d = await card({ clientId: "sarah", phone: "07700 900 456", email: "Sarah@New.co.uk", patchTestDate: "yesterday" });
    expect(d.changes).toEqual([
      { field: "phone", from: "07700 900123", to: "07700 900456", value: "+447700900456" },
      { field: "email", from: "sarah@old.co.uk", to: "sarah@new.co.uk", value: "sarah@new.co.uk" },
      { field: "patchTest", from: null, to: "12 September 2026", value: "2026-09-12" },
    ]);
    expect(db.updates).toEqual([]);
    // A landline groups by its area code, so it is left as it is.
    expect((await card({ clientId: "sarah", phone: "020 7946 0123" })).changes[0].to).toBe("02079460123");
  });

  it("leaves off what is already on file, and says so when nothing differs", async () => {
    const d = await card({ clientId: "sarah", name: "Sarah  Smith", phone: "07700900123" });
    expect(d.changes.map((c) => c.field)).toEqual(["name"]);
    expect(d.changes[0].to).toBe("Sarah Smith");
    const same = await proposeDetails(asker, { clientId: "sarah", email: "SARAH@old.co.uk" }, now);
    expect(same).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    expect(await proposeDetails(asker, { clientId: "sarah" }, now)).toMatchObject({ ok: false });
  });

  it("refuses another client's number or email, as the client's page does", async () => {
    expect(await proposeDetails(asker, { clientId: "sarah", phone: "07700 900999" }, now)).toEqual({
      ok: false,
      message: "Jo Bloggs already has that number.",
    });
    expect(await proposeDetails(asker, { clientId: "sarah", email: "jo@x.co.uk" }, now)).toEqual({
      ok: false,
      message: "Jo Bloggs already has that email.",
    });
    // Another salon's client is no clash, and no client of this one.
    expect((await card({ clientId: "sarah", phone: "07700 900555" })).changes[0].value).toBe("+447700900555");
    expect(await proposeDetails(asker, { clientId: "elsewhere", name: "Sam Smith" }, now)).toMatchObject({ ok: false });
  });

  it("refuses what cannot be right", async () => {
    expect(await proposeDetails(asker, { clientId: "sarah", phone: "12" }, now)).toMatchObject({ ok: false });
    expect(await proposeDetails(asker, { clientId: "sarah", email: "sarah@" }, now)).toMatchObject({ ok: false });
    expect(await proposeDetails(asker, { clientId: "sarah", patchTestDate: "tomorrow" }, now)).toMatchObject({ ok: false });
  });

  it("saves the card as shown, with the name in both halves", async () => {
    const d = await card({ clientId: "sarah", name: "Sarah de Souza", phone: "07700900456", patchTestDate: "Thursday" });
    expect(await commitDraft(asker, d)).toEqual({ ok: true, kind: "details" });
    expect(db.updates).toEqual([
      {
        id: "sarah",
        data: {
          name: "Sarah de Souza",
          firstName: "Sarah",
          lastName: "de Souza",
          phone: "+447700900456",
          patchTestAt: new Date("2026-09-10T12:00:00Z"),
        },
      },
    ]);
  });

  it("does not save a number someone else was given after the card went up", async () => {
    const d = await card({ clientId: "sarah", phone: "07700900456" });
    db.leads[1].phone = "+447700900456";
    expect(await commitDraft(asker, d)).toEqual({ ok: false, message: "Not saved: Jo Bloggs already has that number." });
    expect(db.updates).toEqual([]);
  });
});
