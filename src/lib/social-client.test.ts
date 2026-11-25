import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An Instagram chat has no client until the receptionist files something for
 * them (a booking, a message) or they give a number. It is then filed under
 * that client. A number typed in the chat never finds a client on file by
 * itself: anyone can type hers. A chat still under one of the old made-up
 * clients moves across.
 */

type Lead = { id: string; organizationId: string; phone: string | null; name: string | null; anonymisedAt: null; contactLeadId: string | null };
const db = vi.hoisted(() => ({
  leads: new Map<string, Lead>(),
  filed: [] as Array<{ id: string; leadId: string }>,
  created: [] as Array<Record<string, unknown>>,
  absorbed: 0,
}));

vi.mock("@/lib/prisma", () => {
  const matches = (l: Lead, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v === null ? l[k as keyof Lead] == null : l[k as keyof Lead] === v));
  return {
    prisma: {
      lead: {
        findUnique: async ({ where }: { where: { id: string } }) => db.leads.get(where.id) ?? null,
        findFirst: async ({ where }: { where: Record<string, unknown> }) => [...db.leads.values()].find((l) => matches(l, where)) ?? null,
        findMany: async ({ where }: { where: Record<string, unknown> }) => [...db.leads.values()].filter((l) => matches(l, where)),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          db.created.push(data);
          const lead = { ...(data as object), id: `new${db.created.length}` } as Lead;
          db.leads.set(lead.id, lead);
          return lead;
        },
      },
      socialConversation: {
        update: async ({ where, data }: { where: { id: string }; data: { leadId: string } }) => {
          db.filed.push({ id: where.id, leadId: data.leadId });
          return {};
        },
      },
      // absorbPlaceholder's work is its own; here, only that it ran.
      $transaction: async () => {
        db.absorbed++;
      },
    },
  };
});

import { isPlaceholderPhone, linkSocialClient } from "./social-client";

const LUNA = { phone: "07725 194661", name: "Luna" };
const chat = (leadId: string | null = null) => ({ id: "c1", leadId, contactName: "Yuki" });
const link = (conversation: ReturnType<typeof chat>, contact: { phone: string; name: string | null; leadId?: string } | null) =>
  linkSocialClient({ organizationId: "org", channel: "instagram", conversation, contact });
const lead = (id: string, phone: string | null, name: string | null): Lead => ({ id, organizationId: "org", phone, name, anonymisedAt: null, contactLeadId: null });

beforeEach(() => {
  db.leads.clear();
  db.filed = [];
  db.created = [];
  db.absorbed = 0;
});

describe("filing an Instagram chat under its client", () => {
  it("does nothing until they give a number that reads as one", async () => {
    expect(await link(chat(), null)).toBeNull();
    expect(await link(chat(), { phone: "not a number", name: "Luna" })).toBeNull();
    expect(db.filed).toEqual([]);
  });

  it("files it under the client the booking went on", async () => {
    db.leads.set("luna", lead("luna", "+447725194661", "Luna"));
    expect(await link(chat(), { ...LUNA, leadId: "luna" })).toBe("luna");
    expect(db.filed).toEqual([{ id: "c1", leadId: "luna" }]);
    expect(db.created).toEqual([]);
  });

  it("moves a chat off an old made-up client, taking what was on it", async () => {
    db.leads.set("ph", lead("ph", "instagram-1784123", "Yuki"));
    db.leads.set("luna", lead("luna", "+447725194661", "Luna"));
    expect(await link(chat("ph"), { ...LUNA, leadId: "luna" })).toBe("luna");
    expect(db.filed).toEqual([{ id: "c1", leadId: "luna" }]);
    expect(db.absorbed).toBe(1);
  });

  it("leaves a chat already under a real client where it is", async () => {
    db.leads.set("mum", lead("mum", "+447700900111", "Ann"));
    expect(await link(chat("mum"), { phone: "07700 900222", name: "Daughter" })).toBe("mum");
    expect(db.filed).toEqual([]);
  });

  it("never files it under the client who has a number only typed: a new one, marked as possibly her", async () => {
    db.leads.set("k", lead("k", "+447725194661", "Luna"));
    const id = await link(chat(), { phone: "07725194661", name: null });
    expect(id).not.toBe("k");
    expect(db.created).toEqual([
      expect.objectContaining({ phone: "+447725194661", name: "Yuki", source: "instagram", possibleDuplicateOfId: "k" }),
    ]);
  });

  it("names a new client from what they gave, else the profile", async () => {
    await link(chat(), LUNA);
    await link(chat(), { phone: "07725194662", name: null });
    expect(db.created.map((c) => c.name)).toEqual(["Luna", "Yuki"]);
    expect(db.created.every((c) => c.possibleDuplicateOfId === null)).toBe(true);
  });
});

describe("the made-up numbers", () => {
  it("are told apart from real ones", () => {
    expect(isPlaceholderPhone("instagram-1784123")).toBe(true);
    expect(isPlaceholderPhone("facebook-99")).toBe(true);
    expect(isPlaceholderPhone("+447725194661")).toBe(false);
    expect(isPlaceholderPhone(null)).toBe(false);
  });
});

describe("the number the receptionist used, from a chat's saved history", () => {
  it("is the last one it booked or filed with, in international form", async () => {
    const { lastNumberInSession } = await import("./social-placeholders");
    const tool = (customerPhone: string) => ({ role: "assistant", content: [{ type: "tool_use", input: { customerPhone } }] });
    expect(lastNumberInSession([tool("07725 000001"), { role: "user", content: "hi" }, tool("07725 000002")])).toBe("+447725000002");
    expect(lastNumberInSession([tool("not a number")])).toBeNull();
    expect(lastNumberInSession(null)).toBeNull();
  });
});
