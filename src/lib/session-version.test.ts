import { describe, expect, it } from "vitest";
import { isCurrentSession } from "./session-version";

describe("isCurrentSession", () => {
  it("accepts a cookie issued since the last password change", () => {
    expect(isCurrentSession(2, 2)).toBe(true);
  });

  it("rejects a cookie from before a password change or reset", () => {
    expect(isCurrentSession(1, 2)).toBe(false);
  });

  it("treats a cookie from before versions existed as the first version", () => {
    expect(isCurrentSession(undefined, 0)).toBe(true);
    expect(isCurrentSession(undefined, 1)).toBe(false);
  });
});
