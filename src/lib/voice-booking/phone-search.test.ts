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
      findMany: async ({ where }: { where: { OR: Record<string, unknown>[] } }) =>
        (db.rows as Row[]).filter((r) =>
          where.OR.some((c) => {
            const ends = (c.phone as { endsWith?: string } | undefined)?.endsWith;
            if (ends) return Boolean(r.phone?.endsWith(ends));
            const via = (c.contactLead as { phone?: { endsWith: string } } | undefined)?.phone?.endsWith;
            if (via) return Boolean(r.contactLead?.phone?.endsWith(via));
            const word = (c.name as { contains?: string } | undefined)?.contains;
            return Boolean(word && r.name?.toLowerCase().includes(word));
          })
        ),
    },
  },
}));

import { findClients, phoneSearch, spokenDigits } from "./drafts";

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

describe("phoneSearch", () => {
  it("finds a whole number however it was written, by its last nine digits", () => {
    expect(phoneSearch("07700 900123")).toEqual({ endsWith: "700900123" });
    expect(phoneSearch("+44 7700 900123")).toEqual({ endsWith: "700900123" });
    expect(phoneSearch("who's on 07700-900-123?")).toEqual({ endsWith: "700900123" });
  });

  it("finds a number by its ending", () => {
    expect(phoneSearch("ending 123")).toEqual({ endsWith: "123" });
    expect(phoneSearch("number ending in 0123")).toEqual({ endsWith: "0123" });
  });

  it("reads a number dictation spelled out", () => {
    expect(spokenDigits("oh seven seven double oh nine")).toBe("0 7 7 00 9");
    expect(spokenDigits("07700 double 0 9123")).toBe("07700 00 9123");
    expect(phoneSearch("ending one two three")).toEqual({ endsWith: "123" });
  });

  it("is not a number search for a name, or too few digits to mean anything", () => {
    expect(phoneSearch("Sarah Jones")).toBeNull();
    expect(phoneSearch("Sarah 2")).toBeNull();
  });
});

describe("findClients by number", () => {
  it("goes ahead on a whole number that is one client's own", async () => {
    db.rows = [lead("s", "Sarah Jones", "+447700900123")];
    const [sarah] = await findClients("o", "07700 900123");
    expect(sarah).toMatchObject({ clientId: "s", exactMatch: true });
  });

  it("asks when a child is booked through the same number", async () => {
    db.rows = [
      lead("m", "Mia Jones", null, { name: "Sarah Jones", phone: "+447700900123" }),
      lead("s", "Sarah Jones", "+447700900123"),
    ];
    const found = await findClients("o", "07700 900123");
    // The number's own owner first, and nobody taken as certain.
    expect(found.map((f) => f.clientId)).toEqual(["s", "m"]);
    expect(found.every((f) => !f.exactMatch)).toBe(true);
  });

  it("never treats an ending as certain", async () => {
    db.rows = [lead("s", "Sarah Jones", "+447700900123")];
    expect((await findClients("o", "ending 123"))[0].exactMatch).toBe(false);
  });

  it("needs the name and the number to agree when both are said", async () => {
    db.rows = [lead("t", "Tom Price", "+447700900123"), lead("s", "Sarah Jones", "+447700900999")];
    const found = await findClients("o", "Sarah Jones 07700 900123");
    expect(found.find((f) => f.clientId === "t")!.exactMatch).toBe(false);
    // A misheard digit still finds her by name, ahead of the stranger on that number.
    expect(found[0].clientId).toBe("s");
  });

  it("puts a full name said ahead of a stranger on a spelled-out number", async () => {
    db.rows = [lead("t", "Tom Price", "+447700900123"), lead("s", "Sarah Jones", "+447700900999")];
    const found = await findClients("o", "Sarah Jones oh seven seven double oh nine double oh one two three");
    expect(found[0].clientId).toBe("s");
  });

  it("keeps a hyphenated name's full match", async () => {
    db.rows = [lead("s", "Anne-Marie Smithson", null), lead("a", "Anne-Marie Smith", null)];
    const [first] = await findClients("o", "Anne-Marie Smith");
    expect(first).toMatchObject({ clientId: "a", exactMatch: true });
  });

  it("counts everyone on a number, however many share the name said", async () => {
    db.rows = [
      ...Array.from({ length: 30 }, (_, i) => lead(`x${i}`, `Sarah Jones ${i}`, null)),
      lead("m", "Mia Jones", null, { name: "Sarah Jones", phone: "+447700900123" }),
      lead("s", "Sarah Jones", "+447700900123"),
    ];
    const found = await findClients("o", "Sarah Jones 07700 900123");
    expect(found.find((f) => f.clientId === "s")!.exactMatch).toBe(false);
  });
});
