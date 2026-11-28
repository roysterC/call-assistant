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
// The query itself is Postgres's job; these tests are about what comes back.
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { findMany: async () => db.rows } } }));

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
});
