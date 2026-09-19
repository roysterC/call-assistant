import { describe, expect, it } from "vitest";
import {
  buildServiceTones,
  classifyService,
  familiesInUse,
  FAMILY_STEPS,
  toneFor,
} from "./service-colours";

/** Shogo's real list, which is what the families have to cope with. */
const SHOGO = [
  { name: "Cut and finish", requiresPatchTest: false },
  { name: "Restyle", requiresPatchTest: false },
  { name: "Fringe trim", requiresPatchTest: false },
  { name: "Gents cut", requiresPatchTest: false },
  { name: "Blow dry", requiresPatchTest: false },
  { name: "Root tint", requiresPatchTest: true },
  { name: "Full head colour", requiresPatchTest: true },
  { name: "Half head highlights", requiresPatchTest: true },
  { name: "Full head highlights", requiresPatchTest: true },
  { name: "Balayage", requiresPatchTest: true },
  { name: "Toner", requiresPatchTest: true },
  { name: "Olaplex treatment", requiresPatchTest: false },
];

describe("classifyService", () => {
  it("trusts the patch test over the name", () => {
    // Data beats a guess: a skin test 48h ahead means colour work whatever
    // the salon calls it.
    expect(classifyService("Signature Glow", true)).toBe("colour");
  });

  it("reads cutting from the name", () => {
    expect(classifyService("Cut and finish")).toBe("cutting");
    expect(classifyService("Fringe trim")).toBe("cutting");
    expect(classifyService("Gents cut")).toBe("cutting");
    expect(classifyService("Restyle")).toBe("cutting");
  });

  it("reads finishing and treatments", () => {
    expect(classifyService("Blow dry")).toBe("finishing");
    expect(classifyService("Bridal hair")).toBe("finishing");
    expect(classifyService("Olaplex treatment")).toBe("treatment");
  });

  it("reads colour words even without a patch test flag", () => {
    expect(classifyService("Balayage")).toBe("colour");
    expect(classifyService("Root tint")).toBe("colour");
    expect(classifyService("Half head highlights")).toBe("colour");
  });

  it("falls to neutral rather than borrowing a family's meaning", () => {
    expect(classifyService("Consultation")).toBe("other");
    expect(classifyService("")).toBe("other");
  });
});

describe("buildServiceTones", () => {
  const tones = buildServiceTones(SHOGO);

  it("gives every configured service a tone", () => {
    expect(tones.size).toBe(SHOGO.length);
  });

  it("puts all six colour services in the colour family", () => {
    const colour = SHOGO.filter((s) => s.requiresPatchTest).map((s) =>
      tones.get(s.name.toLowerCase())!
    );
    expect(colour).toHaveLength(6);
    expect(colour.every((t) => t.family === "colour")).toBe(true);
  });

  it("keeps services within a family visually distinct", () => {
    // The first four cutting services must not share a step.
    const cutting = SHOGO.filter(
      (s) => !s.requiresPatchTest && /cut|trim|restyle/i.test(s.name)
    ).map((s) => tones.get(s.name.toLowerCase())!.border);
    expect(new Set(cutting).size).toBe(cutting.length);
  });

  it("is stable — same input, same colours", () => {
    const again = buildServiceTones(SHOGO);
    for (const s of SHOGO) {
      const k = s.name.toLowerCase();
      expect(again.get(k)).toEqual(tones.get(k));
    }
  });

  it("is case-insensitive on lookup, as the stored text is free-form", () => {
    expect(tones.get("balayage")).toBeDefined();
    expect(toneFor("BALAYAGE", tones).family).toBe("colour");
    expect(toneFor("  Balayage  ", tones).family).toBe("colour");
  });

  it("ignores blank and duplicate entries", () => {
    const t = buildServiceTones([
      { name: "Cut" },
      { name: "  " },
      { name: "cut" },
    ]);
    expect(t.size).toBe(1);
  });

  it("cycles steps rather than inventing a hue past the last one", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `Cut ${i}` }));
    const t = buildServiceTones(many);
    const used = new Set([...t.values()].map((v) => v.border));
    expect(used.size).toBe(FAMILY_STEPS.cutting.length);
  });
});

describe("toneFor", () => {
  it("greys a service that is no longer configured", () => {
    const tones = buildServiceTones(SHOGO);
    // An appointment booked under a service since renamed or deleted.
    expect(toneFor("Hot oil ritual", tones).family).toBe("other");
  });
});

describe("familiesInUse", () => {
  it("lists only the families the salon actually offers, in order", () => {
    expect(familiesInUse(SHOGO)).toEqual([
      "cutting",
      "colour",
      "finishing",
      "treatment",
    ]);
  });

  it("is empty for a salon with nothing configured", () => {
    expect(familiesInUse([])).toEqual([]);
  });
});
