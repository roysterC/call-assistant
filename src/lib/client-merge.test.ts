import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Merging a duplicate card into the client kept: everything on it moves,
 * the kept card takes only what it is missing, and the duplicate goes. The
 * database is an in-memory stand-in for the where-clauses the merge writes.
 */

type Row = Record<string, unknown> & { id: string };
const tables = vi.hoisted(() => ({}) as Record<string, Row[]>);

vi.mock("@/lib/prisma", () => {
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v === null) return r[k] == null;
      if (v && typeof v === "object" && "not" in (v as object)) return r[k] !== (v as { not: unknown }).not;
      return r[k] === v;
    });
  const table = (name: string) => ({
    findFirst: async ({ where }: { where: Record<string, unknown> }) => (tables[name] ?? []).find((r) => matches(r, where)) ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = (tables[name] ?? []).filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Object.assign(tables[name].find((r) => r.id === where.id)!, data),
    delete: async ({ where }: { where: { id: string } }) => {
      tables[name] = tables[name].filter((r) => r.id !== where.id);
    },
  });
  const client = Object.fromEntries(
    ["lead", "appointment", "callback", "call", "rebookText", "whatsAppConversation", "websiteConversation", "socialConversation"].map(
      (n) => [n, table(n)]
    )
  );
  return { prisma: { ...client, $transaction: async (fn: (tx: unknown) => unknown) => fn(client) } };
});

import { mergeClients, notADuplicate } from "./client-merge";

const lead = (id: string, extra: Record<string, unknown> = {}): Row => ({
  id,
  organizationId: "org",
  anonymisedAt: null,
  name: null,
  phone: null,
  email: null,
  company: null,
  issue: null,
  notes: null,
  patchTestAt: null,
  rebookTextsOff: false,
  contactLeadId: null,
  possibleDuplicateOfId: null,
  ...extra,
});
const get = (id: string) => tables.lead.find((l) => l.id === id);

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.lead = [
    lead("ann", { name: "Ann Lee", phone: "+447700900111", notes: "Almond shape", patchTestAt: new Date("2026-01-01") }),
    lead("dup", {
      name: "Annie",
      phone: "+447700900111",
      email: "ann@example.com",
      notes: "Allergic to acrylic",
      patchTestAt: new Date("2026-06-01"),
      rebookTextsOff: true,
      possibleDuplicateOfId: "ann",
    }),
    lead("kid", { name: "Mia", contactLeadId: "dup" }),
    lead("other", { name: "Annie L", possibleDuplicateOfId: "dup" }),
  ];
  tables.appointment = [{ id: "a1", organizationId: "org", leadId: "dup" }];
  tables.callback = [{ id: "cb", organizationId: "org", leadId: "dup" }];
  tables.call = [];
  tables.rebookText = [{ id: "r1", organizationId: "org", leadId: "dup" }];
  tables.whatsAppConversation = [];
  tables.websiteConversation = [{ id: "w1", organizationId: "org", leadId: "dup" }];
  tables.socialConversation = [];
});

describe("mergeClients", () => {
  it("moves everything on the duplicate to the client kept, and deletes it", async () => {
    const r = await mergeClients("org", "dup", "ann");
    expect(r).toEqual({ ok: true, into: "ann", moved: { appointments: 1, callbacks: 1, calls: 0, chats: 1 } });
    expect(get("dup")).toBeUndefined();
    for (const t of ["appointment", "callback", "rebookText", "websiteConversation"]) {
      expect(tables[t].every((r) => r.leadId === "ann")).toBe(true);
    }
    expect(get("kid")!.contactLeadId).toBe("ann");
    expect(get("other")!.possibleDuplicateOfId).toBe("ann");
  });

  it("keeps what the kept client has, and takes only what it is missing", async () => {
    await mergeClients("org", "dup", "ann");
    expect(get("ann")).toMatchObject({
      name: "Ann Lee",
      email: "ann@example.com",
      notes: "Almond shape\n\nAllergic to acrylic",
      patchTestAt: new Date("2026-06-01"),
      // Either asking for no rebooking texts is a no.
      rebookTextsOff: true,
      possibleDuplicateOfId: null,
    });
  });

  it("never leaves the kept client reached through itself", async () => {
    // Merging a parent into the child reached through her: the child takes
    // the number, and is reached through nobody.
    get("kid")!.contactLeadId = "dup";
    await mergeClients("org", "dup", "kid");
    expect(get("kid")).toMatchObject({ phone: "+447700900111", contactLeadId: null });
  });

  it("refuses the same card twice, and one not in this salon or deleted", async () => {
    expect(await mergeClients("org", "ann", "ann")).toMatchObject({ ok: false, status: 400 });
    expect(await mergeClients("elsewhere", "dup", "ann")).toMatchObject({ ok: false, status: 404 });
    get("ann")!.anonymisedAt = new Date();
    expect(await mergeClients("org", "dup", "ann")).toMatchObject({ ok: false, status: 404 });
    expect(get("dup")).toBeDefined();
  });
});

describe("notADuplicate", () => {
  it("takes the mark off and leaves both cards", async () => {
    expect(await notADuplicate("org", "dup")).toBe(true);
    expect(get("dup")!.possibleDuplicateOfId).toBeNull();
    expect(get("ann")).toBeDefined();
    expect(await notADuplicate("elsewhere", "dup")).toBe(false);
  });
});
