import { describe, expect, it, vi } from "vitest";
import type { SalonConfig } from "@/lib/booking";

const db = vi.hoisted(() => ({
  settings: null as null | { businessName: string; contactPhone: string | null; salonFaq: string | null },
  cfg: null as unknown,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { organizationSettings: { findUnique: async () => db.settings } },
}));
vi.mock("@/lib/booking", async (real) => ({
  ...(await real<typeof import("@/lib/booking")>()),
  getSalonConfig: async () => db.cfg,
}));

import { SALON_FAQ_MAX, parseSalonFaq, salonFactsForChat, salonQuestionsSection } from "./salon-knowledge";
import { buildSystem } from "@/lib/receptionist/prompt";
import { withSalonFacts } from "@/lib/claude";

const salon = {
  diary: "native",
  timeZone: "Europe/London",
  hours: [
    { day: 2, closed: false, open: "09:00", close: "18:00" },
    { day: 1, closed: true, open: "09:00", close: "18:00" },
  ],
  services: [
    { name: "Cut and finish", durationMinutes: 45, bufferMinutes: 0, requiresPatchTest: false, priceMinor: 4500 },
    { name: "Balayage", durationMinutes: 180, bufferMinutes: 0, requiresPatchTest: true, priceMinor: 15050 },
    { name: "Fringe trim", durationMinutes: 15, bufferMinutes: 0, requiresPatchTest: false, priceMinor: null },
  ],
  stylists: [{ name: "Jo", role: "owner", workingDays: [], services: [], bookable: true }],
  calComApiKey: null,
  calComEventTypeId: null,
} as unknown as SalonConfig;

const FAQ = "Parking: six spaces behind the salon.\nCancellations: 24 hours' notice please.";

describe("the salon's FAQ as stored", () => {
  it("is trimmed, capped, and null when empty", () => {
    expect(parseSalonFaq("  Parking: behind.  \r\n")).toBe("Parking: behind.");
    expect(parseSalonFaq("   ")).toBeNull();
    expect(parseSalonFaq(42)).toBeNull();
    expect(parseSalonFaq("x".repeat(SALON_FAQ_MAX + 50))).toHaveLength(SALON_FAQ_MAX);
  });
});

describe("the rules for questions", () => {
  it("allows general hair knowledge but not guessed salon facts", () => {
    const text = salonQuestionsSection(null, "phone");
    expect(text).toMatch(/what a toner or Olaplex does/);
    // The list is the whole list: sounding like a listed service is not a yes.
    expect(text).toMatch(/The services listed are everything the salon offers/);
    expect(text).toMatch(/has not said it does balayage/);
    expect(text).toMatch(/Never guess a fact about the salon/);
    expect(text).toMatch(/allergies/);
    expect(text).toContain("has not written any yet");
  });

  it("falls back to a callback on the phone and to the team in a chat", () => {
    expect(salonQuestionsSection(null, "phone")).toMatch(/take a message so the team can ring them back/);
    expect(salonQuestionsSection(null, "chat")).toMatch(/the team will get back to them/);
  });
});

describe("the phone receptionist", () => {
  it("is given starting prices, the FAQ and the rules", () => {
    const [stable] = buildSystem(salon, "Shogo", null, new Date("2026-09-25T17:05:00Z"), null, FAQ);
    expect(stable.text).toContain("Cut and finish — about 45 minutes, from £45");
    expect(stable.text).toContain("Balayage — about 3h, from £150.50 (patch test for new clients)");
    // No price set: listed bare, and the rules say not to give a figure.
    expect(stable.text).toMatch(/Fringe trim — about 15 minutes\n/);
    expect(stable.text).toContain("If a service has no price listed, do not give a figure");
    expect(stable.text).toContain("Parking: six spaces behind the salon.");
  });

  it("still has the rules when the salon has written nothing", () => {
    const [stable] = buildSystem(salon, "Shogo", null, new Date("2026-09-25T17:05:00Z"), null);
    expect(stable.text).toContain("# Questions about the salon");
    expect(stable.text).toContain("has not written any yet");
  });
});

describe("the chat bots", () => {
  it("get the hours, prices, team, FAQ and where to book", () => {
    const facts = salonFactsForChat({ cfg: salon, faq: FAQ, businessName: "Shogo", contactPhone: "01234 567890" })!;
    expect(facts).toContain("# About Shogo");
    expect(facts).toContain("Monday — closed");
    expect(facts).toContain("Cut and finish — about 45 minutes, from £45");
    expect(facts).toContain("- Jo, owner.");
    expect(facts).toContain("Cancellations: 24 hours' notice please.");
    expect(facts).toMatch(/never say a time is free/);
    expect(facts).toContain("ring the salon on 01234 567890");
  });

  it("leave a business with nothing to say alone", () => {
    const bare = { ...salon, services: [], hours: [], stylists: [] };
    expect(salonFactsForChat({ cfg: bare, faq: null, businessName: "DOAI", contactPhone: null })).toBeNull();
    // An FAQ alone is enough.
    expect(salonFactsForChat({ cfg: bare, faq: "Open late Thursdays.", businessName: "X", contactPhone: null })).toContain(
      "Open late Thursdays."
    );
  });

  it("have the facts added after their own prompt", async () => {
    db.settings = { businessName: "Shogo", contactPhone: null, salonFaq: FAQ };
    db.cfg = salon;
    const prompt = await withSalonFacts("org", "You are Shogo's website assistant.");
    expect(prompt.startsWith("You are Shogo's website assistant.")).toBe(true);
    expect(prompt).toContain("from £45");
    expect(prompt).toContain("Parking: six spaces");

    db.cfg = { ...salon, services: [], hours: [], stylists: [] };
    db.settings = { businessName: "DOAI", contactPhone: null, salonFaq: null };
    expect(await withSalonFacts("org", "Agency prompt.")).toBe("Agency prompt.");
  });

  it("still answer if the facts cannot be loaded", async () => {
    db.cfg = null;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await withSalonFacts("org", "Prompt.")).toBe("Prompt.");
    spy.mockRestore();
  });
});
