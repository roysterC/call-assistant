import { describe, expect, it } from "vitest";
import {
  buildServiceTones,
  classifyService,
  familiesInUse,
  familyChoices,
  FAMILY_STEPS,
  NEW_BOOKING,
  solidTint,
  toneFor,
} from "./service-colours";

/** A nail salon's price list, as the families have to cope with it. */
const MENU = [
  { name: "Gel manicure" },
  { name: "Manicure no colour" },
  { name: "Full pedicure gel colour" },
  { name: "Toenail colour change" },
  { name: "Acrylic full set gel colour" },
  { name: "Acrylic infill French tip" },
  { name: "BIAB full set colour" },
  { name: "BIAB infill colour" },
  { name: "Nail art tier 1" },
  { name: "Gel removal" },
];

describe("classifyService", () => {
  it("reads a nail salon's price list", () => {
    expect(classifyService("Gel manicure")).toBe("manicure");
    expect(classifyService("Gel pedicure")).toBe("pedicure");
    expect(classifyService("BIAB new set")).toBe("enhancement");
    expect(classifyService("BIAB infill")).toBe("enhancement");
    expect(classifyService("Acrylic full set")).toBe("enhancement");
    expect(classifyService("Cuticle care")).toBe("manicure");
    expect(classifyService("Nail art, per nail")).toBe("nailart");
  });

  it("puts the more particular word first", () => {
    // A removal before it is gel; toes before the BIAB or extension on them.
    expect(classifyService("Gel removal")).toBe("nailart");
    expect(classifyService("BIAB on toes")).toBe("pedicure");
    expect(classifyService("Toenail extension")).toBe("pedicure");
    expect(classifyService("Toenail designs")).toBe("nailart");
  });

  it("treats a French tip as a finish, not as nail art", () => {
    expect(classifyService("Acrylic infill French tip")).toBe("enhancement");
    expect(classifyService("Full pedicure French tip")).toBe("pedicure");
  });

  it("matches whole words only", () => {
    expect(classifyService("Angel art")).toBe("nailart");
    expect(classifyService("Angel glow")).toBe("other");
    expect(classifyService("Settle in")).toBe("other");
  });

  it("falls to neutral rather than borrowing a family's meaning", () => {
    expect(classifyService("Consultation")).toBe("other");
    expect(classifyService("")).toBe("other");
  });

  it("reads a salon saved as another trade as a nail salon", () => {
    expect(classifyService("Gel manicure", false, ["hair" as never])).toBe("manicure");
  });
});

describe("buildServiceTones", () => {
  const tones = buildServiceTones(MENU);

  it("gives every configured service a tone", () => {
    expect(tones.size).toBe(MENU.length);
  });

  it("keeps services within a family visually distinct", () => {
    const enh = MENU.filter((s) => /acrylic|biab/i.test(s.name)).map((s) => tones.get(s.name.toLowerCase())!.border);
    expect(enh).toHaveLength(4);
    expect(new Set(enh).size).toBe(enh.length);
  });

  it("is stable — same input, same colours", () => {
    const again = buildServiceTones(MENU);
    for (const s of MENU) {
      const k = s.name.toLowerCase();
      expect(again.get(k)).toEqual(tones.get(k));
    }
  });

  it("is case-insensitive on lookup, as the stored text is free-form", () => {
    expect(tones.get("gel manicure")).toBeDefined();
    expect(toneFor("GEL MANICURE", tones).family).toBe("manicure");
    expect(toneFor("  Gel manicure  ", tones).family).toBe("manicure");
  });

  it("ignores blank and duplicate entries", () => {
    const t = buildServiceTones([{ name: "Gel manicure" }, { name: "  " }, { name: "gel manicure" }]);
    expect(t.size).toBe(1);
  });

  it("cycles steps rather than inventing a hue past the last one", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `Manicure ${i}` }));
    const t = buildServiceTones(many);
    const used = new Set([...t.values()].map((v) => v.border));
    expect(used.size).toBe(FAMILY_STEPS.blue.length);
  });

  it("gives each family its own validated hue, and Other grey", () => {
    const t = buildServiceTones([{ name: "Gel manicure" }, { name: "Gel pedicure" }, { name: "Consultation" }]);
    expect(t.get("gel manicure")!.border).toBe(`${FAMILY_STEPS.blue[0]}b3`);
    expect(t.get("gel pedicure")!.border).toBe(`${FAMILY_STEPS.orange[0]}b3`);
    expect(t.get("consultation")!.border).toBe(`${FAMILY_STEPS.grey[0]}b3`);
  });
});

describe("toneFor", () => {
  it("greys a service that is no longer configured and says nothing", () => {
    const tones = buildServiceTones(MENU);
    expect(toneFor("Hot stone ritual", tones).family).toBe("other");
  });

  it("colours a booking under an old service name by what the name says", () => {
    // Booked before a new price list replaced these names.
    const tones = buildServiceTones([{ name: "Gel manicure" }]);
    expect(toneFor("Acrylic infill", tones).family).toBe("enhancement");
    expect(toneFor("Shellac pedicure", tones).family).toBe("pedicure");
    // Several old services: by the first, the longest, as for current ones.
    expect(toneFor("Acrylic full set + Nail art", tones).family).toBe("enhancement");
  });
});

describe("familiesInUse", () => {
  it("lists only the families the salon actually offers, in hue order", () => {
    const list = [{ name: "Gel manicure" }, { name: "Acrylic full set" }, { name: "Gel removal" }, { name: "Consultation" }];
    expect(familiesInUse(list)).toEqual(["manicure", "enhancement", "nailart", "other"]);
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
    const tones = buildServiceTones(MENU);
    const fills = [...tones.values()].map((t) => t.fill).concat(NEW_BOOKING.fill, toneFor("Gone service", tones).fill);
    for (const f of fills) expect(f).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("the starter price list", () => {
  it("gives every starter service a colour, none grey", async () => {
    const { starterServices } = await import("@/lib/business-types");
    const grey = starterServices(["nails"]).filter((s) => classifyService(s.name) === "other");
    expect(grey.map((s) => s.name)).toEqual([]);
  });
});

describe("the salon's own choice", () => {
  it("wins over the name", () => {
    expect(classifyService("Signature glow", false, ["nails"], "manicure")).toBe("manicure");
    expect(classifyService("Gel manicure", false, ["nails"], "other")).toBe("other");
  });

  it("is ignored where it is not one of the salon's families", () => {
    // Chosen when the salon was set up as a hair salon.
    expect(classifyService("Gel manicure", false, ["nails"], "cutting")).toBe("manicure");
  });

  it("is offered from the salon's own families, then Other", () => {
    expect(familyChoices(["nails"])).toEqual(["manicure", "pedicure", "enhancement", "nailart", "other"]);
    expect(familyChoices()).toEqual(familyChoices(["nails"]));
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
