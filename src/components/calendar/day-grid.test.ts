import { describe, expect, it } from "vitest";
import { columnBackground } from "./day-grid";

describe("columnBackground", () => {
  it("is plain card white with nothing closed or blocked", () => {
    expect(columnBackground([])).toBe("var(--card)");
  });

  it("leaves a see-through hole for each closed or blocked stretch, overlaps merged", () => {
    expect(
      columnBackground([
        { topPct: 0, heightPct: 10 },
        { topPct: 40, heightPct: 10 },
        { topPct: 45, heightPct: 10 },
      ])
    ).toBe(
      "linear-gradient(to bottom, transparent 0% 10%, var(--card) 10% 40%, transparent 40% 55%, var(--card) 55% 100%)"
    );
  });
});
