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
    for (const status of ["free", "trialing", "active", "restricted", "no-such-state"]) {
      expect(modelsForSalon(status)).toContain("claude-haiku-5-5");
      expect(modelsForSalon(status)).not.toContain("claude-haiku-4-5");
    }
  });

  it("moves a site that picked Haiku 4.5 across to Haiku 5.5, not up to Sonnet", () => {
    expect(resolveModelForSite("free", "claude-haiku-4-5")).toBe("claude-haiku-5-5");
    expect(resolveModelForSite("active", "claude-haiku-4-5")).toBe("claude-haiku-5-5");
  });

  it("gives everyone the standard model unless a salon Kikai does not bill picks another", () => {
    expect(resolveModelForSite("active", null)).toBe("claude-haiku-5-5");
    expect(resolveModelForSite("active", "claude-sonnet-5")).toBe("claude-haiku-5-5");
    expect(resolveModelForSite("free", null)).toBe("claude-haiku-5-5");
    expect(resolveModelForSite("free", "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(resolveModelForSite("free", "claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });
});

describe("the 'Powered by Kikai' line", () => {
  it("shows on every billed salon's chat, and hides only where Kikai does not bill and the site asks", async () => {
    const { shouldShowBranding } = await import("./branding");
    expect(shouldShowBranding("active", true)).toBe(true);
    expect(shouldShowBranding("trialing", true)).toBe(true);
    expect(shouldShowBranding("free", false)).toBe(true);
    expect(shouldShowBranding("free", true)).toBe(false);
  });
});
