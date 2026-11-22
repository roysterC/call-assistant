import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { organizationSettings: { findUnique }, phoneNumber: { findMany } },
}));

const { designChatsFor, designRule } = await import("./design-chats");

const settings = (over: Record<string, unknown> = {}) => ({
  whatsappEnabled: false,
  instagramEnabled: false,
  instagramUsername: null,
  facebookEnabled: false,
  ...over,
});

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset().mockResolvedValue([]);
});

describe("designChatsFor", () => {
  it("is null for a salon that takes messages nowhere", async () => {
    findUnique.mockResolvedValue(settings());
    expect(await designChatsFor("org1")).toBeNull();
  });

  it("knows when WhatsApp is the number they rang", async () => {
    findUnique.mockResolvedValue(settings({ whatsappEnabled: true }));
    findMany.mockResolvedValue([
      { channel: "whatsapp", number: "+442074317546" },
      { channel: "vapi", number: "+442074317546" },
    ]);
    expect((await designChatsFor("org1"))?.whatsapp).toEqual({ number: "+442074317546", sameAsLine: true });
  });

  it("leaves out Instagram with no username, and drops an @", async () => {
    findUnique.mockResolvedValue(settings({ instagramEnabled: true, instagramUsername: null }));
    expect(await designChatsFor("org1")).toBeNull();
    findUnique.mockResolvedValue(settings({ instagramEnabled: true, instagramUsername: "@shogo.nails" }));
    expect((await designChatsFor("org1"))?.instagram).toBe("shogo.nails");
  });
});

describe("designRule", () => {
  it("sends a design to the salon's messages, saying the handle aloud", () => {
    const rule = designRule({ whatsapp: { number: "+442074317546", sameAsLine: true }, instagram: "shogo.nails", facebook: false })!;
    expect(rule).toContain("WhatsApp (this same number) or Instagram (@shogo.nails)");
    expect(rule).toContain("at shogo dot nails, and we'll quote it there");
    expect(rule).toContain("Do not take a message for a design quote");
  });

  it("gives the WhatsApp number when it isn't the line they rang", () => {
    const rule = designRule({ whatsapp: { number: "+447700900123", sameAsLine: false }, instagram: null, facebook: false })!;
    expect(rule).toContain("WhatsApp (+447700900123)");
    expect(rule).toContain("Then give the number.");
  });

  it("says nothing when there is nowhere to send it", () => {
    expect(designRule(null)).toBeNull();
  });
});
