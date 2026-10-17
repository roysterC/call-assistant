import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  phoneNumber: { findMany: vi.fn() },
  organizationSettings: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  claimedOrganizations,
  isKnownVerifyToken,
  signatureMatches,
  verifiedOrganizations,
  whatsappSender,
} from "./meta-credentials";

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const waBody = (phoneNumberId: string) =>
  JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId } } }] }] });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WHATSAPP_APP_SECRET", "");
  vi.stubEnv("META_APP_SECRET", "");
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("signatureMatches", () => {
  it("takes Meta's header for this body and secret, and nothing else", () => {
    expect(signatureMatches("hello", sign("hello", "s1"), "s1")).toBe(true);
    expect(signatureMatches("hello", sign("hello", "s1"), "s2")).toBe(false);
    expect(signatureMatches("hello!", sign("hello", "s1"), "s1")).toBe(false);
    expect(signatureMatches("hello", null, "s1")).toBe(false);
    expect(signatureMatches("hello", sign("hello", "s1").slice(7), "s1")).toBe(false);
  });
});

describe("claimedOrganizations", () => {
  it("finds the salon by the WhatsApp number written to", async () => {
    db.phoneNumber.findMany.mockResolvedValue([{ organizationId: "shogo" }]);
    expect(await claimedOrganizations("whatsapp", JSON.parse(waBody("111")))).toEqual(["shogo"]);
    expect(db.phoneNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channel: "whatsapp", whatsappPhoneNumberId: { in: ["111"] } } })
    );
  });

  it("finds the salon by Instagram account or Facebook Page", async () => {
    db.organizationSettings.findMany.mockResolvedValue([{ organizationId: "shogo" }]);
    await claimedOrganizations("messenger", { object: "instagram", entry: [{ id: "ig1" }] });
    expect(db.organizationSettings.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { instagramBusinessId: { in: ["ig1"] } } })
    );
    await claimedOrganizations("messenger", { object: "page", entry: [{ id: "pg1" }] });
    expect(db.organizationSettings.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { facebookPageId: { in: ["pg1"] } } })
    );
  });

  it("claims nobody for a body that names nothing", async () => {
    expect(await claimedOrganizations("whatsapp", { entry: "nonsense" })).toEqual([]);
    expect(await claimedOrganizations("messenger", { object: "user", entry: [{ id: "x" }] })).toEqual([]);
    expect(await claimedOrganizations("messenger", null)).toEqual([]);
  });
});

describe("verifiedOrganizations", () => {
  const body = waBody("111");

  it("accepts a delivery signed with the salon's own secret", async () => {
    db.organizationSettings.findMany.mockResolvedValue([{ organizationId: "shogo", metaAppSecret: "shogo-secret" }]);
    const v = await verifiedOrganizations("whatsapp", body, sign(body, "shogo-secret"), ["shogo"]);
    expect([...v]).toEqual(["shogo"]);
  });

  it("refuses one salon's secret vouching for another salon", async () => {
    db.organizationSettings.findMany.mockResolvedValue([
      { organizationId: "shogo", metaAppSecret: "shogo-secret" },
      { organizationId: "other", metaAppSecret: "other-secret" },
    ]);
    const v = await verifiedOrganizations("whatsapp", body, sign(body, "other-secret"), ["shogo", "other"]);
    expect([...v]).toEqual(["other"]);
  });

  it("does not let the shared key vouch for a salon that has its own", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "shared");
    db.organizationSettings.findMany.mockResolvedValue([{ organizationId: "shogo", metaAppSecret: "shogo-secret" }]);
    const v = await verifiedOrganizations("whatsapp", body, sign(body, "shared"), ["shogo"]);
    expect(v.size).toBe(0);
  });

  it("falls back to the shared key for a salon without one yet, and says so", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "shared");
    db.organizationSettings.findMany.mockResolvedValue([{ organizationId: "shogo", metaAppSecret: null }]);
    const v = await verifiedOrganizations("whatsapp", body, sign(body, "shared"), ["shogo"]);
    expect([...v]).toEqual(["shogo"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no Meta app secret of its own"));
  });

  it("refuses everything in production when there is no secret at all", async () => {
    db.organizationSettings.findMany.mockResolvedValue([{ organizationId: "shogo", metaAppSecret: null }]);
    expect((await verifiedOrganizations("whatsapp", body, null, ["shogo"])).size).toBe(0);
  });

  it("lets unsigned through locally when there is no secret at all", async () => {
    vi.stubEnv("NODE_ENV", "development");
    db.organizationSettings.findMany.mockResolvedValue([{ organizationId: "shogo", metaAppSecret: null }]);
    expect([...(await verifiedOrganizations("whatsapp", body, null, ["shogo"]))]).toEqual(["shogo"]);
  });
});

describe("isKnownVerifyToken", () => {
  it("knows a salon's own token", async () => {
    db.organizationSettings.findFirst.mockResolvedValue({ organizationId: "shogo" });
    expect(await isKnownVerifyToken("whatsapp", "shogo-token")).toBe(true);
    expect(db.organizationSettings.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { metaVerifyToken: "shogo-token" } })
    );
  });

  it("knows the shared fallback, and refuses anything else or nothing", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "shared-token");
    db.organizationSettings.findFirst.mockResolvedValue(null);
    expect(await isKnownVerifyToken("whatsapp", "shared-token")).toBe(true);
    expect(await isKnownVerifyToken("whatsapp", "guess")).toBe(false);
    expect(await isKnownVerifyToken("whatsapp", "")).toBe(false);
    expect(await isKnownVerifyToken("whatsapp", null)).toBe(false);
  });
});

describe("whatsappSender", () => {
  it("sends from the number written to, with the salon's own token", async () => {
    db.organizationSettings.findUnique.mockResolvedValue({ whatsappAccessToken: "shogo-token" });
    expect(await whatsappSender("shogo", "111")).toEqual({ phoneNumberId: "111", accessToken: "shogo-token" });
  });

  it("uses the shared token only until the salon has one, and none at all is none", async () => {
    db.organizationSettings.findUnique.mockResolvedValue({ whatsappAccessToken: null });
    expect(await whatsappSender("shogo", "111")).toBeNull();
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "shared");
    expect(await whatsappSender("shogo", "111")).toEqual({ phoneNumberId: "111", accessToken: "shared" });
  });
});
