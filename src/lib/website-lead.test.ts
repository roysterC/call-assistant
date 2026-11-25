import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A website visitor proves nothing about who they are: anyone can type a
 * client's email or number. So a form or a chat never opens, changes or
 * books onto a client on file by what is typed: it makes a new client,
 * marked as possibly the one whose details were given, for the salon to
 * merge. A conversation already filed under a client keeps them, and only
 * fills what is missing there. The database is stood in for.
 */

type Lead = {
  id: string;
  organizationId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  company: string | null;
  issue: string | null;
  notes: string | null;
  anonymisedAt: Date | null;
  contactLeadId: string | null;
  possibleDuplicateOfId: string | null;
};
const db = vi.hoisted(() => ({ leads: [] as Lead[] }));

vi.mock("@/lib/prisma", () => {
  const matches = (l: Lead, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v === null ? l[k as keyof Lead] == null : l[k as keyof Lead] === v));
  const lead = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => db.leads.find((l) => matches(l, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => db.leads.filter((l) => matches(l, where)),
    update: async ({ where, data }: { where: { id: string }; data: Partial<Lead> }) => {
      const l = db.leads.find((x) => x.id === where.id)!;
      Object.assign(l, data);
      return l;
    },
    create: async ({ data }: { data: Partial<Lead> }) => {
      const l = { ...blank(`new-${db.leads.length}`), ...data } as Lead;
      db.leads.push(l);
      return l;
    },
  };
  function blank(id: string): Lead {
    return { id, organizationId: "org", email: null, phone: null, name: null, company: null, issue: null, notes: null, anonymisedAt: null, contactLeadId: null, possibleDuplicateOfId: null };
  }
  return { prisma: { lead } };
});

import { upsertWebsiteLead } from "./website-lead";
import { fillGaps } from "./claude";

const sarah = (): Lead => ({
  id: "sarah",
  organizationId: "org",
  email: "sarah@example.com",
  phone: "+447700900111",
  name: "Sarah Jones",
  company: null,
  issue: null,
  notes: null,
  anonymisedAt: null,
  contactLeadId: null,
  possibleDuplicateOfId: null,
});
const made = (id: string) => db.leads.find((l) => l.id === id)!;

beforeEach(() => {
  db.leads = [sarah()];
});

describe("upsertWebsiteLead", () => {
  it("never opens a client's card for someone who gives her email: a new one, marked as possibly her", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "Sarah@example.com", name: "Mallory", phone: "+447700900999" });
    expect(r.id).not.toBe("sarah");
    expect(made(r.id)).toMatchObject({ email: "sarah@example.com", name: "Mallory", possibleDuplicateOfId: "sarah" });
    expect(db.leads[0]).toEqual(sarah());
  });

  it("keeps a conversation's own client, filling only what she is missing", async () => {
    db.leads[0].company = null;
    const r = await upsertWebsiteLead({
      organizationId: "org",
      leadId: "sarah",
      email: "other@example.com",
      name: "Mallory",
      phone: "+447700900999",
      company: "Acme",
      issue: "BIAB infill on Saturday",
    });
    expect(r.id).toBe("sarah");
    expect(db.leads[0]).toMatchObject({
      name: "Sarah Jones",
      email: "sarah@example.com",
      phone: "+447700900111",
      company: "Acme",
      issue: "BIAB infill on Saturday",
    });
    expect(db.leads).toHaveLength(1);
  });

  it("never gives a number to the conversation's client, even one without one", async () => {
    db.leads[0].phone = null;
    await upsertWebsiteLead({ organizationId: "org", leadId: "sarah", email: "sarah@example.com", phone: "+447700900999" });
    expect(db.leads[0].phone).toBeNull();
  });

  it("gives a new client the number she types, unmarked when nobody has it", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", name: "Amy", phone: "+447700900222" });
    expect(made(r.id)).toMatchObject({ email: "amy@example.com", phone: "+447700900222", possibleDuplicateOfId: null });
  });

  it("marks a new client giving another's number as possibly her, however it is typed, and leaves hers alone", async () => {
    for (const typed of ["+447700900111", "07700 900111", "07700900111", "0044 7700 900 111", "447700900111"]) {
      db.leads = [sarah()];
      const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", phone: typed });
      expect(made(r.id)).toMatchObject({ phone: "+447700900111", possibleDuplicateOfId: "sarah" });
      expect(db.leads[0]).toEqual(sarah());
    }
  });

  it("stores a new client's number in the international form, as every other number is", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", phone: "07700 900 222" });
    expect(made(r.id).phone).toBe("+447700900222");
  });

  it("leaves off a number that is not one", async () => {
    const r = await upsertWebsiteLead({ organizationId: "org", email: "amy@example.com", phone: "call me maybe" });
    expect(made(r.id).phone).toBeNull();
  });

  it("does not take a deleted client for anyone", async () => {
    db.leads[0].anonymisedAt = new Date();
    const r = await upsertWebsiteLead({ organizationId: "org", email: "sarah@example.com" });
    expect(made(r.id).possibleDuplicateOfId).toBeNull();
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
