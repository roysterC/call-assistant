import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A website visitor proves nothing about who they are: anyone can type a
 * client's email. So a form or a chat may add a new client, or fill gaps in
 * one on file, but never change the number or name she already has. The
 * database is stood in for.
 */

type Lead = { id: string; organizationId: string; email: string | null; phone: string | null; name: string | null; company: string | null; issue: string | null; notes: string | null };
const db = vi.hoisted(() => ({ leads: [] as Lead[] }));

vi.mock("@/lib/prisma", () => {
  const match = (where: Record<string, Record<string, string> | string>) => {
    if (typeof where.id === "string") return db.leads.find((l) => l.id === where.id) ?? null;
    const byEmail = where.organizationId_email as Record<string, string> | undefined;
    if (byEmail) return db.leads.find((l) => l.organizationId === byEmail.organizationId && l.email === byEmail.email) ?? null;
    const byPhone = where.organizationId_phone as Record<string, string> | undefined;
    if (byPhone) return db.leads.find((l) => l.organizationId === byPhone.organizationId && l.phone === byPhone.phone) ?? null;
    return null;
  };
  return {
    prisma: {
      lead: {
        findUnique: async ({ where }: { where: Record<string, Record<string, string> | string> }) => match(where),
        update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) => {
          const l = db.leads.find((x) => x.id === where.id)!;
          Object.assign(l, data);
          return { id: l.id };
        },
        create: async ({ data }: { data: Partial<Lead> }) => {
          const l = { id: `new-${db.leads.length}`, email: null, phone: null, name: null, company: null, issue: null, notes: null, organizationId: "org", ...data } as Lead;
          db.leads.push(l);
          return { id: l.id };
        },
      },
    },
  };
});

import { upsertWebsiteLead } from "./website-lead";
import { fillGaps } from "./claude";

const sarah = (): Lead => ({ id: "sarah", organizationId: "org", email: "sarah@example.com", phone: "+447700900111", name: "Sarah Jones", company: null, issue: null, notes: null });

beforeEach(() => {
  db.leads = [sarah()];
});

describe("upsertWebsiteLead", () => {
  it("never puts a stranger's number on a client who gives her email", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "Sarah@example.com", name: "Mallory", phone: "+447700900999" });
    expect(r.id).toBe("sarah");
    expect(db.leads[0]).toMatchObject({ phone: "+447700900111", name: "Sarah Jones" });
  });

  it("does not give a number to a client on file without one either", async () => {
    db.leads[0].phone = null;
    await upsertWebsiteLead({ organizationId: "org", email: "sarah@example.com", phone: "+447700900999" });
    expect(db.leads[0].phone).toBeNull();
  });

  it("still records what she wants now", async () => {
    await upsertWebsiteLead({ organizationId: "org", email: "sarah@example.com", issue: "BIAB infill on Saturday" });
    expect(db.leads[0].issue).toBe("BIAB infill on Saturday");
  });

  it("gives a new client the number she types", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", name: "Amy", phone: "+447700900222" });
    expect(db.leads.find((l) => l.id === r.id)).toMatchObject({ email: "amy@example.com", phone: "+447700900222" });
  });

  it("does not let a new client claim a number another client has, however it is typed", async () => {
    for (const typed of ["+447700900111", "07700 900111", "07700900111", "0044 7700 900 111", "447700900111"]) {
      db.leads = [sarah()];
      const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", phone: typed });
      expect(db.leads.find((l) => l.id === r.id)!.phone).toBeNull();
      expect(db.leads[0].phone).toBe("+447700900111");
    }
  });

  it("stores a new client's number in the international form, as every other number is", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", phone: "07700 900 222" });
    expect(db.leads.find((l) => l.id === r.id)!.phone).toBe("+447700900222");
  });

  it("leaves off a number that is not one", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", phone: "call me maybe" });
    expect(db.leads.find((l) => l.id === r.id)!.phone).toBeNull();
  });
});

describe("fillGaps (what a chat may write onto a client on file)", () => {
  it("never replaces a name, email or company already there", () => {
    expect(fillGaps({ name: "Sarah Jones", email: "sarah@example.com", company: "Acme" }, { name: "Mallory", email: "m@evil.test", company: "Evil" })).toEqual({});
  });

  it("fills what is missing, and always takes what they want now", () => {
    expect(fillGaps({ name: null, email: "sarah@example.com", company: null }, { name: "Sarah", email: "x@y.z", company: "Acme", issue: "Gel" })).toEqual({
      name: "Sarah",
      company: "Acme",
      issue: "Gel",
    });
  });
});
