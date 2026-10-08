import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { DEFAULT_RECEPTIONIST_MODEL, receptionistModel, receptionistRequestOptions } from "./session";

afterEach(() => {
  delete process.env.RECEPTIONIST_MODEL;
  delete process.env.RECEPTIONIST_EFFORT;
});

describe("the receptionist's model", () => {
  it("is Haiku 5.5 unless RECEPTIONIST_MODEL says otherwise", () => {
    expect(DEFAULT_RECEPTIONIST_MODEL).toBe("claude-haiku-5-5");
    expect(receptionistModel()).toBe("claude-haiku-5-5");
    process.env.RECEPTIONIST_MODEL = "claude-haiku-4-5";
    expect(receptionistModel()).toBe("claude-haiku-4-5");
  });

  it("runs Haiku 5.5 with thinking off, at the model's default effort", () => {
    expect(receptionistRequestOptions("claude-haiku-5-5")).toEqual({
      thinking: { type: "disabled" },
      output_config: { effort: "medium" },
    });
  });

  it("takes an effort from RECEPTIONIST_EFFORT, but only one allowed with thinking off", () => {
    process.env.RECEPTIONIST_EFFORT = "High";
    expect(receptionistRequestOptions("claude-haiku-5-5").output_config).toEqual({ effort: "high" });
    // xhigh and max are refused by the API with thinking off.
    process.env.RECEPTIONIST_EFFORT = "max";
    expect(receptionistRequestOptions("claude-haiku-5-5").output_config).toEqual({ effort: "medium" });
  });

  it("sends nothing extra for Haiku 4.5, which refuses an effort setting", () => {
    process.env.RECEPTIONIST_EFFORT = "high";
    expect(receptionistRequestOptions("claude-haiku-4-5")).toEqual({});
  });
});
