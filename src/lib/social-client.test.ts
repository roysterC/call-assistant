import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An Instagram chat has no client until they give a number; then it is filed
 * under the client with that number, and a chat still under one of the old
 * made-up clients moves across.
 */

const db = vi.hoisted(() => ({
  leads: new Map<string, { id: string; phone: string | null; name: string | null }>(),
  filed: [] as Array<{ id: string; leadId: string }>,
  created: [] as Array<Record<string, unknown>>,
  absorbed: 0,
  forBooking: [] as Array<[string, string, string, string]>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      findUnique: async ({ where }: { where: { id?: string; organizationId_phone?: { phone: string } } }) =>
        where.id
          ? (db.leads.get(where.id) ?? null)
          : ([...db.leads.values()].find((l) => l.phone === where.organizationId_phone?.phone) ?? null),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        const lead = { id: `new${db.created.length}`, phone: data.phone as string, name: (data.name as string) ?? null };
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
}));
vi.mock("@/lib/client-link", () => ({
  clientForBooking: async (org: string, phone: string, name: string, source: string) => {
    db.forBooking.push([org, phone, name, source]);
    return { lead: { id: "luna", phone, name }, contact: null };
  },
}));

import { isPlaceholderPhone, linkSocialClient } from "./social-client";

const LUNA = { phone: "07725 194661", name: "Luna" };
const chat = (leadId: string | null = null) => ({ id: "c1", leadId, contactName: "Yuki" });
const link = (conversation: ReturnType<typeof chat>, contact: { phone: string; name: string | null } | null) =>
  linkSocialClient({ organizationId: "org", channel: "instagram", conversation, contact });

beforeEach(() => {
  db.leads.clear();
  db.filed = [];
  db.created = [];
  db.absorbed = 0;
  db.forBooking = [];
});

describe("filing an Instagram chat under its client", () => {
  it("does nothing until they give a number that reads as one", async () => {
    expect(await link(chat(), null)).toBeNull();
    expect(await link(chat(), { phone: "not a number", name: "Luna" })).toBeNull();
    expect(db.filed).toEqual([]);
  });

  it("files it under the client the booking went on, by the number and name given", async () => {
    expect(await link(chat(), LUNA)).toBe("luna");
    expect(db.forBooking).toEqual([["org", "+447725194661", "Luna", "instagram"]]);
    expect(db.filed).toEqual([{ id: "c1", leadId: "luna" }]);
  });

  it("moves a chat off an old made-up client, taking what was on it", async () => {
    db.leads.set("ph", { id: "ph", phone: "instagram-1784123", name: "Yuki" });
    expect(await link(chat("ph"), LUNA)).toBe("luna");
    expect(db.filed).toEqual([{ id: "c1", leadId: "luna" }]);
    expect(db.absorbed).toBe(1);
  });

  it("leaves a chat already under a real client where it is", async () => {
    db.leads.set("mum", { id: "mum", phone: "+447700900111", name: "Ann" });
    expect(await link(chat("mum"), { phone: "07700 900222", name: "Daughter" })).toBe("mum");
    expect(db.filed).toEqual([]);
  });

  it("without a name, uses the number's own client, or makes one named from the profile", async () => {
    db.leads.set("k", { id: "k", phone: "+447725194661", name: "Luna" });
    expect(await link(chat(), { phone: "07725194661", name: null })).toBe("k");
    db.leads.clear();
    await link(chat(), { phone: "07725194661", name: null });
    expect(db.created).toEqual([{ organizationId: "org", phone: "+447725194661", name: "Yuki", source: "instagram" }]);
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
