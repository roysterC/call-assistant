import { describe, expect, it } from "vitest";
import { columnBackground } from "./day-grid";

describe("columnBackground", () => {
  it("is the plain lane colour with nothing closed or blocked", () => {
    expect(columnBackground([])).toBe("var(--diary-lane)");
  });

  it("leaves a see-through hole for each closed or blocked stretch, overlaps merged", () => {
    expect(
      columnBackground([
        { topPct: 0, heightPct: 10 },
        { topPct: 40, heightPct: 10 },
        { topPct: 45, heightPct: 10 },
      ])
    ).toBe(
      "linear-gradient(to bottom, transparent 0% 10%, var(--diary-lane) 10% 40%, transparent 40% 55%, var(--diary-lane) 55% 100%)"
    );
  });
});
