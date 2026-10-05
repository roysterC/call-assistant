import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./safe-redirect";

describe("safeCallbackUrl", () => {
  it("keeps a path inside the app", () => {
    expect(safeCallbackUrl("/calendar?date=2026-10-05")).toBe("/calendar?date=2026-10-05");
  });

  it("sends nothing, or the root, to the start page rather than back to the login page", () => {
    expect(safeCallbackUrl(null)).toBe("/start");
    expect(safeCallbackUrl("")).toBe("/start");
    expect(safeCallbackUrl("/")).toBe("/start");
  });

  it("never leaves the origin", () => {
    expect(safeCallbackUrl("https://example.invalid")).toBe("/start");
    expect(safeCallbackUrl("//example.invalid")).toBe("/start");
    expect(safeCallbackUrl("/\\example.invalid")).toBe("/start");
  });
});
