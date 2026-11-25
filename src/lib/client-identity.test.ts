import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who a client is (client-identity.ts, client-link.ts): one card per person;
 * a number or email may be several people's; a number the channel proved
 * finds the client who has it, and one only typed never does. The database
 * is an in-memory stand-in.
 */

type Lead = {
  id: string;
  organizationId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  contactLeadId: string | null;
  possibleDuplicateOfId: string | null;
  anonymisedAt: Date | null;
  createdAt: Date;
};
const db = vi.hoisted(() => ({ leads: [] as Lead[], seq: 0, locks: [] as string[] }));

vi.mock("@/lib/prisma", () => {
  const matches = (l: Lead, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const cell = l[k as keyof Lead];
      if (v === null) return cell == null;
      if (v && typeof v === "object" && "in" in (v as object)) return (v as { in: unknown[] }).in.includes(cell);
      return cell === v;
    });
  const sorted = (rows: Lead[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lead = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => sorted(db.leads).find((l) => matches(l, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => sorted(db.leads).filter((l) => matches(l, where)),
    create: async ({ data }: { data: Partial<Lead> }) => {
      const l: Lead = {
        id: `new${++db.seq}`,
        organizationId: "org",
        name: null,
        phone: null,
        email: null,
        contactLeadId: null,
        possibleDuplicateOfId: null,
        anonymisedAt: null,
        createdAt: new Date(2026, 0, 1, 0, db.seq),
        ...data,
      };
      db.leads.push(l);
      return l;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) =>
      Object.assign(db.leads.find((l) => l.id === where.id)!, data),
  };
  const prisma = {
    lead,
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      db.locks.push(String(values[0]));
      return 0;
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return { prisma };
});

import { clientForNumber, newClientFromTyped, numberHolder } from "./client-identity";
import { clientForBooking, findClientOnNumber, peopleOnNumber } from "./client-link";
import { prisma } from "./prisma";

const ANN = "+447700900111";
const card = (id: string, name: string, phone: string | null, minute: number, extra: Partial<Lead> = {}) =>
  db.leads.push({
    id,
    organizationId: "org",
    name,
    phone,
    email: null,
    contactLeadId: null,
    possibleDuplicateOfId: null,
    anonymisedAt: null,
    createdAt: new Date(2025, 0, 1, 0, minute),
    ...extra,
  });

beforeEach(() => {
  db.leads = [];
  db.seq = 0;
  db.locks = [];
});

describe("a number several clients share", () => {
  beforeEach(() => {
    // A couple on one phone: Ann had it first.
    card("ann", "Ann Lee", ANN, 1);
    card("tom", "Tom Lee", ANN, 2);
    // Their daughter, reached through Ann's.
    card("mia", "Mia Lee", null, 3, { contactLeadId: "ann" });
  });

  it("reaches its first client", async () => {
    expect((await numberHolder(prisma, "org", ANN))!.id).toBe("ann");
    expect((await clientForNumber("org", ANN, { name: "Someone", source: "whatsapp" })).id).toBe("ann");
  });

  it("books each of them on their own card, from the number", async () => {
    expect((await clientForBooking("org", ANN, "Tom", "phone")).lead.id).toBe("tom");
    expect((await clientForBooking("org", ANN, "Ann Lee", "phone")).lead.id).toBe("ann");
    const mia = await clientForBooking("org", ANN, "Mia", "phone");
    expect(mia.lead.id).toBe("mia");
    expect(mia.contact!.id).toBe("ann");
    expect(db.leads).toHaveLength(3);
  });

  it("lets a call from it manage all of theirs", async () => {
    expect((await peopleOnNumber("org", ANN)).map((p) => [p.id, p.isHolder])).toEqual([
      ["ann", true],
      ["tom", true],
      ["mia", false],
    ]);
  });

  it("does not reach a client who was deleted", async () => {
    db.leads[0].anonymisedAt = new Date();
    expect((await numberHolder(prisma, "org", ANN))!.id).toBe("tom");
  });

  it("chooses and makes clients for it one at a time", async () => {
    await clientForBooking("org", ANN, "Tom", "phone");
    expect(db.locks[0]).toBe(`client|org|${ANN}`);
  });
});

describe("a number only typed or said", () => {
  beforeEach(() => card("ann", "Ann Lee", ANN, 1));

  it("never books on the client who has it, even under her name: a new card, marked as possibly her", async () => {
    const { lead } = await clientForBooking("org", ANN, "Ann Lee", "website", { proof: "typed" });
    expect(lead).toMatchObject({ name: "Ann Lee", phone: ANN, possibleDuplicateOfId: "ann", source: "website" });
    expect(lead.id).not.toBe("ann");
  });

  it("finds nothing on her card to read out", async () => {
    expect(await findClientOnNumber("org", ANN, "Ann Lee", { proof: "typed" })).toBeNull();
    expect((await findClientOnNumber("org", ANN, "Ann Lee"))!.id).toBe("ann");
  });

  it("books the chat's own client as them", async () => {
    card("chat", "Ann", null, 5);
    expect((await clientForBooking("org", ANN, "Ann Lee", "website", { proof: "typed", clientId: "chat" })).lead.id).toBe("chat");
    // Someone else in the same chat is someone new.
    const other = await clientForBooking("org", ANN, "Mia", "website", { proof: "typed", clientId: "chat" });
    expect(other.lead.id).not.toBe("chat");
  });
});

describe("a new card from typed details", () => {
  it("is marked as possibly the client reached through the number under that name", async () => {
    card("ann", "Ann Lee", ANN, 1);
    card("mia", "Mia Lee", null, 2, { contactLeadId: "ann" });
    const c = await newClientFromTyped(prisma, "org", { name: "Mia Lee", phone: "07700 900111", source: "instagram" });
    expect(c).toMatchObject({ phone: ANN, possibleDuplicateOfId: "mia" });
  });

  it("is marked as possibly the client with its email", async () => {
    card("ann", "Ann Lee", ANN, 1, { email: "ann@example.com" });
    const c = await newClientFromTyped(prisma, "org", { email: " Ann@Example.com ", source: "website" });
    expect(c).toMatchObject({ email: "ann@example.com", possibleDuplicateOfId: "ann" });
  });

  it("is not marked when nobody has its details", async () => {
    card("ann", "Ann Lee", ANN, 1, { email: "ann@example.com" });
    const c = await newClientFromTyped(prisma, "org", { name: "Zoe", phone: "07700 900222", email: "zoe@example.com", source: "website" });
    expect(c.possibleDuplicateOfId).toBeNull();
  });
});
