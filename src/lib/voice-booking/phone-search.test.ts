import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  name: string | null;
  phone: string | null;
  patchTestAt: Date | null;
  contactLead: { name: string | null; phone: string | null } | null;
  appointments: { startsAt: Date; status: string }[];
};
const db = vi.hoisted(() => ({ rows: [] as unknown[] }));
// A small stand-in for Postgres: the number lookup and the name lookup, as findClients asks them.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findMany: async ({ where, take }: { where: { OR: Record<string, unknown>[] }; take?: number }) =>
        (db.rows as Row[]).filter((r) =>
          where.OR.some((c) => {
            const ends = (c.phone as { endsWith?: string } | undefined)?.endsWith;
            if (ends) return Boolean(r.phone?.endsWith(ends));
            const via = (c.contactLead as { phone?: { endsWith: string } } | undefined)?.phone?.endsWith;
            if (via) return Boolean(r.contactLead?.phone?.endsWith(via));
            const word = (c.name as { contains?: string } | undefined)?.contains;
            return Boolean(word && r.name?.toLowerCase().includes(word));
          })
        ).slice(0, take),
    },
  },
}));

import { findClients, isNumberText, phoneDigits, phoneSearch } from "./drafts";

const lead = (id: string, name: string, phone: string | null, contact?: { name: string; phone: string }): Row => ({
  id,
  name,
  phone,
  patchTestAt: null,
  contactLead: contact ?? null,
  appointments: [],
});

beforeEach(() => {
  db.rows = [];
});

const find = (name: string | null, phone: string | null = null) => findClients("o", { name, phone });

describe("phoneSearch", () => {
  it("finds a whole number however it was written, by its last nine digits", () => {
    expect(phoneSearch("07700 900123")).toEqual({ endsWith: "700900123" });
    expect(phoneSearch("+44 7700 900123")).toEqual({ endsWith: "700900123" });
    expect(phoneSearch("07700 - 900 - 123")).toEqual({ endsWith: "700900123" });
  });

  it("finds a number by its ending", () => {
    expect(phoneSearch("ending 123")).toEqual({ endsWith: "123" });
    expect(phoneSearch("ending in 0123")).toEqual({ endsWith: "0123" });
  });

  it("reads a number dictation spelled out", () => {
    expect(phoneDigits("oh seven seven double oh nine")).toBe("077009");
    expect(phoneDigits("07700 double 0 9123")).toBe("07700009123");
    expect(phoneDigits("ending one two three")).toBe("123");
    // A lone digit word leading in is not a digit.
    expect(phoneDigits("the one ending 123")).toBe("123");
    // Only digit words: nothing an object happens to have.
    expect(phoneDigits("constructor toString 12")).toBeNull();
  });

  it("is no number with fewer than three digits", () => {
    expect(phoneSearch("12")).toBeNull();
    expect(phoneSearch("")).toBeNull();
  });
});

describe("findClients", () => {
  it("goes ahead on a whole number that is one client's own", async () => {
    db.rows = [lead("s", "Sarah Jones", "+447700900123")];
    expect((await find(null, "07700 900123"))[0]).toMatchObject({ clientId: "s", exactMatch: true, onThatNumber: true });
  });

  it("asks when a child is booked through the same number", async () => {
    db.rows = [
      lead("m", "Mia Jones", null, { name: "Sarah Jones", phone: "+447700900123" }),
      lead("s", "Sarah Jones", "+447700900123"),
    ];
    const found = await find(null, "07700 900123");
    // The number's own owner first, and nobody taken as certain.
    expect(found.map((f) => f.clientId)).toEqual(["s", "m"]);
    expect(found.every((f) => !f.exactMatch)).toBe(true);
  });

  it("never treats an ending as certain", async () => {
    db.rows = [lead("s", "Sarah Jones", "+447700900123")];
    expect((await find(null, "ending 123"))[0].exactMatch).toBe(false);
  });

  it("needs a name said with the number to fit its owner", async () => {
    db.rows = [lead("s", "Sarah Jones", "+447700900123")];
    expect((await find("Sarah Smith", "07700 900123"))[0].exactMatch).toBe(false);
    expect((await find("Sarah", "07700 900123"))[0].exactMatch).toBe(true);
    expect((await find("Mrs Jones", "07700 900123"))[0].exactMatch).toBe(true);
    expect((await find("Ji-woo Oh", "07700 900123"))[0].exactMatch).toBe(false);
  });

  it("matches a surname with an accent or apostrophe written either way", async () => {
    db.rows = [lead("p", "María Pérez", "+447700900123"), lead("b", "Jo O'Brien", null)];
    expect((await find("Mrs Perez", "07700 900123"))[0].exactMatch).toBe(true);
    expect((await find("Jo O’Brien"))[0]).toMatchObject({ clientId: "b", exactMatch: true });
  });

  it("still finds a client by name when a misheard digit finds a stranger", async () => {
    db.rows = [lead("t", "Tom Price", "+447700900123"), lead("s", "Sarah Jones", "+447700900999")];
    const found = await find("Sarah Jones", "07700 900123");
    expect(found.map((f) => f.clientId)).toEqual(["t", "s"]);
    expect(found.every((f) => !f.exactMatch)).toBe(true);
  });

  it("keeps everyone on the number, however many share the name said", async () => {
    db.rows = [
      ...Array.from({ length: 30 }, (_, i) => lead(`x${i}`, `Sarah Jones ${i}`, null)),
      lead("k", "Karen Smith", "+447700900123"),
    ];
    const found = await find("Sarah", "07700 900123");
    expect(found[0]).toMatchObject({ clientId: "k", onThatNumber: true });
  });

  it("finds a two-letter first name when the surname is misheard", async () => {
    db.rows = [lead("j", "Jo Smith", null)];
    expect((await find("Jo Smyth")).map((f) => f.clientId)).toEqual(["j"]);
  });

  it("looks up a number given as the name", async () => {
    db.rows = [lead("s", "Sarah Jones", "+447700900123")];
    expect((await find("07700 900123"))[0]).toMatchObject({ clientId: "s", exactMatch: true });
    expect(isNumberText("oh seven seven double oh nine double oh one two three")).toBe(true);
    expect(isNumberText("Sarah 07700 900123")).toBe(false);
  });

  it("keeps a full name said even when many share the number's ending", async () => {
    db.rows = [
      ...Array.from({ length: 6 }, (_, i) => lead(`e${i}`, `Client ${i}`, `+44770090${i}124`)),
      lead("s", "Sarah Jones", "+447700900123"),
    ];
    const found = await find("Sarah Jones", "ending 124");
    expect(found.some((f) => f.clientId === "s")).toBe(true);
  });
});
