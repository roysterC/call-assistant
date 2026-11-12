import { describe, expect, it } from "vitest";
import {
  buildServiceTones,
  classifyService,
  familiesInUse,
  familyChoices,
  familyHue,
  FAMILY_STEPS,
  NEW_BOOKING,
  solidTint,
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

  it("colours a booking under an old service name by what the name says", () => {
    // Booked before a new price list replaced these names.
    const tones = buildServiceTones([{ name: "Ladies cut and blow dry" }, { name: "Roots colour", requiresPatchTest: true }]);
    expect(toneFor("Cut and finish", tones).family).toBe("cutting");
    expect(toneFor("Root tint", tones).family).toBe("colour");
    expect(toneFor("Balayage", tones).family).toBe("colour");
    expect(toneFor("Blow dry", tones).family).toBe("finishing");
    expect(toneFor("Olaplex treatment", tones).family).toBe("treatment");
    // Several old services: by the first, the longest, as for current ones.
    expect(toneFor("Full head colour + Cut and finish", tones).family).toBe("colour");
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

describe("solidTint", () => {
  it("mixes the hue with white rather than leaving it see-through", () => {
    expect(solidTint("#000000", 0.18)).toBe("#d1d1d1");
    expect(solidTint("#ffffff")).toBe("#ffffff");
    expect(solidTint("#3f88d4", 1)).toBe("#3f88d4");
  });

  it("gives every booking fill a solid six-digit colour, new ones included", () => {
    const tones = buildServiceTones(SHOGO);
    const fills = [...tones.values()].map((t) => t.fill).concat(NEW_BOOKING.fill, toneFor("Gone service", tones).fill);
    for (const f of fills) expect(f).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("each trade's own families", () => {
  it("gives every starter service of every trade a colour, none grey", async () => {
    const { starterServices, BUSINESS_TYPES } = await import("@/lib/business-types");
    for (const t of BUSINESS_TYPES) {
      const grey = starterServices([t]).filter((s) => classifyService(s.name, s.requiresPatchTest, [t]) === "other");
      expect(grey.map((s) => `${t}: ${s.name}`)).toEqual([]);
    }
  });

  it("reads a nail salon's price list as nails, not hair", () => {
    const nails = ["nails"] as const;
    expect(classifyService("Gel manicure", false, nails)).toBe("manicure");
    expect(classifyService("Gel pedicure", false, nails)).toBe("pedicure");
    expect(classifyService("BIAB new set", false, nails)).toBe("enhancement");
    expect(classifyService("BIAB infill", false, nails)).toBe("enhancement");
    expect(classifyService("Acrylic full set", false, nails)).toBe("enhancement");
    // A removal before it is gel; toes before the BIAB on them.
    expect(classifyService("Gel removal", false, nails)).toBe("nailart");
    expect(classifyService("BIAB on toes", false, nails)).toBe("pedicure");
    expect(classifyService("Nail art, per nail", false, nails)).toBe("nailart");
    expect(classifyService("Cuticle care", false, nails)).toBe("manicure");
  });

  it("reads beauty and barbers in their own words", () => {
    expect(classifyService("Lash lift and tint", true, ["beauty"])).toBe("brows");
    expect(classifyService("Half leg wax", false, ["beauty"])).toBe("waxing");
    expect(classifyService("Express facial", false, ["beauty"])).toBe("skin");
    expect(classifyService("Skin fade", false, ["barber"])).toBe("fades");
    expect(classifyService("Beard trim", false, ["barber"])).toBe("beard");
    expect(classifyService("Haircut and beard", false, ["barber"])).toBe("cuts");
  });

  it("matches whole words only, so a cuticle is not a cut", () => {
    expect(classifyService("Cuticle care")).toBe("other");
    expect(classifyService("Freestyle art")).toBe("other");
    expect(classifyService("Two cuts")).toBe("cutting");
    expect(classifyService("Blow-dry")).toBe("finishing");
  });

  it("lists a nail salon's families in its legend, in hue order", () => {
    const list = [{ name: "Gel manicure" }, { name: "Acrylic full set" }, { name: "Gel removal" }, { name: "Consultation" }];
    expect(familiesInUse(list, ["nails"])).toEqual(["manicure", "enhancement", "nailart", "other"]);
  });

  it("gives each family its own validated hue, and Other grey", () => {
    const tones = buildServiceTones([{ name: "Gel manicure" }, { name: "Gel pedicure" }, { name: "Consultation" }], ["nails"]);
    expect(tones.get("gel manicure")!.border).toBe(`${FAMILY_STEPS.cutting[0]}b3`);
    expect(tones.get("gel pedicure")!.border).toBe(`${FAMILY_STEPS.colour[0]}b3`);
    expect(tones.get("consultation")!.border).toBe(`${FAMILY_STEPS.other[0]}b3`);
  });

  it("colours a booking under an old name with the salon's own families", () => {
    const tones = buildServiceTones([{ name: "Gel manicure" }], ["nails"]);
    expect(toneFor("Acrylic infill", tones).family).toBe("enhancement");
  });
});

describe("a salon of several trades", () => {
  const both = ["hair", "nails"] as const;

  it("is coloured by trade, by whichever trade's word fits the name best", () => {
    expect(classifyService("Wash and blow dry", false, both)).toBe("hair");
    expect(classifyService("Gel manicure", false, both)).toBe("nails");
    // Nails' "acrylic" over hair's "set".
    expect(classifyService("Acrylic full set", false, both)).toBe("nails");
    expect(classifyService("Root tint", true, both)).toBe("hair");
    expect(classifyService("Lash lift and tint", true, ["hair", "beauty"])).toBe("beauty");
  });

  it("lists its trades in the legend, main first", () => {
    expect(familiesInUse([{ name: "Ladies cut" }, { name: "Gel manicure" }], both)).toEqual(["hair", "nails"]);
    expect(familyHue("hair", both)).not.toBe(familyHue("nails", both));
  });
});

describe("the salon's own choice", () => {
  it("wins over the name", () => {
    expect(classifyService("Signature glow", false, ["nails"], "manicure")).toBe("manicure");
    expect(classifyService("Gel manicure", false, ["nails"], "other")).toBe("other");
  });

  it("is ignored where it is not one of the salon's families", () => {
    // Chosen at a hair salon, then the salon became a nail salon.
    expect(classifyService("Gel manicure", false, ["nails"], "cutting")).toBe("manicure");
  });

  it("is offered from the salon's own families, then Other", () => {
    expect(familyChoices(["nails"])).toEqual(["manicure", "pedicure", "enhancement", "nailart", "other"]);
    expect(familyChoices(["hair", "beauty"])).toEqual(["hair", "beauty", "other"]);
  });

  it("is kept when services are saved, and only if it looks like one", async () => {
    const { parseServices } = await import("@/lib/salon-config");
    const [kept, dropped, none] = parseServices([
      { name: "A", durationMinutes: 30, group: "manicure" },
      { name: "B", durationMinutes: 30, group: "<script>" },
      { name: "C", durationMinutes: 30 },
    ]);
    expect(kept.group).toBe("manicure");
    expect(dropped).not.toHaveProperty("group");
    expect(none).not.toHaveProperty("group");
  });
});
