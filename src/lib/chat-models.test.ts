import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { currentModelName } from "./chat-models";
import { modelsForSalon, resolveModelForSite } from "./claude";

afterEach(() => {
  delete process.env.CHAT_MODEL;
});

describe("chat models after the move to Haiku 5.5", () => {
  it("reads the old Haiku as the new one, and leaves everything else alone", () => {
    expect(currentModelName("claude-haiku-4-5")).toBe("claude-haiku-5-5");
    expect(currentModelName("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(currentModelName(null)).toBeNull();
    expect(currentModelName("")).toBe("");
  });

  it("offers Haiku 5.5 to every salon, and no longer Haiku 4.5", () => {
    for (const status of [true, false, null]) {
      expect(modelsForSalon(status)).toContain("claude-haiku-5-5");
      expect(modelsForSalon(status)).not.toContain("claude-haiku-4-5");
    }
  });

  it("moves a site that picked Haiku 4.5 across to Haiku 5.5, not up to Sonnet", () => {
    expect(resolveModelForSite(true, "claude-haiku-4-5")).toBe("claude-haiku-5-5");
    expect(resolveModelForSite(false, "claude-haiku-4-5")).toBe("claude-haiku-5-5");
  });

  it("gives everyone the standard model, and the better one only to premium chat that picks it", () => {
    expect(resolveModelForSite(false, null)).toBe("claude-haiku-5-5");
    expect(resolveModelForSite(false, "claude-sonnet-5")).toBe("claude-haiku-5-5");
    expect(resolveModelForSite(true, null)).toBe("claude-haiku-5-5");
    expect(resolveModelForSite(true, "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(resolveModelForSite(true, "claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });
});

describe("the 'Powered by Kikai' line", () => {
  it("shows on every chat, and hides only with premium chat when the site asks", async () => {
    const { shouldShowBranding } = await import("./branding");
    expect(shouldShowBranding(false, true)).toBe(true);
    expect(shouldShowBranding(null, true)).toBe(true);
    expect(shouldShowBranding(true, false)).toBe(true);
    expect(shouldShowBranding(true, true)).toBe(false);
  });
});
