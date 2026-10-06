import { describe, expect, it } from "vitest";
import { servicesSummary } from "./service-picker";

describe("servicesSummary", () => {
  it("says everything when none are ticked", () => {
    expect(servicesSummary([])).toBe("Everything");
  });

  it("names one or two, and counts the rest after that", () => {
    expect(servicesSummary(["Root Tint"])).toBe("Root Tint");
    expect(servicesSummary(["Root Tint", "Balayage"])).toBe("Root Tint and Balayage");
    expect(servicesSummary(["Root Tint", "Balayage", "Toner", "Gloss"])).toBe("Root Tint and 3 more");
  });
});
