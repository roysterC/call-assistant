import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { instagramHost, isInstagramLoginToken } from "./meta-messaging";

describe("which host an Instagram token is used on", () => {
  it("Instagram Login tokens on graph.instagram.com; Unified and Facebook Login ones on graph.facebook.com", () => {
    expect(isInstagramLoginToken("IGAAxyz")).toBe(true);
    expect(instagramHost("IGAAxyz")).toBe("https://graph.instagram.com/v21.0");
    expect(isInstagramLoginToken("EAAxyz")).toBe(false);
    expect(instagramHost("EAAxyz")).toBe("https://graph.facebook.com/v21.0");
  });
});
