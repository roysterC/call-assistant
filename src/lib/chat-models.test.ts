import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { currentModelName } from "./chat-models";
import { modelsForPlan, resolveModelForSite } from "./claude";

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

  it("offers Haiku 5.5 on every plan, and no longer Haiku 4.5", () => {
    for (const plan of ["starter", "pro", "custom", "no-such-plan"]) {
      expect(modelsForPlan(plan)).toContain("claude-haiku-5-5");
      expect(modelsForPlan(plan)).not.toContain("claude-haiku-4-5");
    }
  });

  it("moves a site that picked Haiku 4.5 across to Haiku 5.5, not up to Sonnet", () => {
    expect(resolveModelForSite("pro", "claude-haiku-4-5")).toBe("claude-haiku-5-5");
    expect(resolveModelForSite("starter", "claude-haiku-4-5")).toBe("claude-haiku-5-5");
  });

  it("still gives a site with no choice the best its plan allows", () => {
    expect(resolveModelForSite("starter", null)).toBe("claude-haiku-5-5");
    expect(resolveModelForSite("pro", null)).toBe("claude-sonnet-5");
    expect(resolveModelForSite("starter", "claude-sonnet-5")).toBe("claude-haiku-5-5");
  });
});
