import { describe, expect, it } from "vitest";
import { parseServices } from "@/lib/salon-config";
import {
  bookedName,
  clashingNames,
  flattenMenu,
  flattenMenuWithPlaces,
  menuFromServices,
  menuOf,
  parseMenu,
  STARTER_MENU,
  uniqueId,
  type SalonMenu,
} from "./nail-menu";

const menu: SalonMenu = {
  treatments: [
    {
      id: "acrylic",
      name: "Acrylic",
      group: "enhancement",
      kinds: [
        { name: "Acrylic full set", durationMinutes: 75, priceMinor: 3500, rebookWeeks: 3, rebookAs: "Acrylic infill" },
        { name: "Acrylic infill", durationMinutes: 60, priceMinor: 2800, rebookWeeks: 3 },
      ],
      finishes: [
        { name: "Gel colour", priceMinor: 0, minutes: 0 },
        { name: "French tip", priceMinor: 500, minutes: 10 },
      ],
      extras: ["art"],
    },
    { id: "removals", name: "Removals", kinds: [{ name: "Acrylic take off", durationMinutes: 30, priceMinor: 1000 }], finishes: [], extras: [] },
  ],
  extras: [{ id: "art", name: "Nail art, tier 2", durationMinutes: 20, priceMinor: 1500, photo: true }],
};

describe("flattenMenu", () => {
  const flat = flattenMenu(menu);

  it("makes one service per kind and finish, named as it is said", () => {
    expect(flat.map((s) => s.name)).toEqual([
      "Acrylic full set, gel colour",
      "Acrylic full set, French tip",
      "Acrylic infill, gel colour",
      "Acrylic infill, French tip",
      "Acrylic take off",
      "Nail art, tier 2",
    ]);
  });

  it("adds a finish's price and time to the kind's", () => {
    const s = flat.find((x) => x.name === "Acrylic infill, French tip")!;
    expect(s).toMatchObject({ durationMinutes: 70, priceMinor: 3300, group: "enhancement", treatment: "Acrylic" });
  });

  it("rebooks a full set as the infill in the same finish", () => {
    expect(flat.find((x) => x.name === "Acrylic full set, French tip")).toMatchObject({
      rebookWeeks: 3,
      rebookAs: "Acrylic infill, French tip",
    });
  });

  it("marks extras, and those priced from a photo", () => {
    expect(flat.find((x) => x.name === "Nail art, tier 2")).toMatchObject({ extra: true, photoQuote: true, priceMinor: 1500 });
  });

  it("leaves an unpriced kind unpriced in every finish", () => {
    const m = structuredClone(menu);
    m.treatments[0].kinds[1].priceMinor = null;
    expect(flattenMenu(m).find((x) => x.name === "Acrylic infill, French tip")!.priceMinor).toBeNull();
  });

  it("says where each name came from", () => {
    const { places } = flattenMenuWithPlaces(menu);
    expect(places.get("acrylic infill, french tip")).toEqual({ type: "treatment", treatmentId: "acrylic", kind: 1, finish: 1 });
    expect(places.get("acrylic take off")).toEqual({ type: "treatment", treatmentId: "removals", kind: 0, finish: -1 });
    expect(places.get("nail art, tier 2")).toEqual({ type: "extra", extraId: "art" });
  });

  it("survives the flat list's own parser unchanged", () => {
    expect(parseServices(JSON.parse(JSON.stringify(flat)))).toEqual(flat);
  });
});

describe("bookedName", () => {
  it("lowers a finish's first letter, but not a name's or an abbreviation's", () => {
    expect(bookedName({ name: "Manicure" }, { name: "Gel" })).toBe("Manicure, gel");
    expect(bookedName({ name: "Infill" }, { name: "French tip" })).toBe("Infill, French tip");
    expect(bookedName({ name: "Overlay" }, { name: "BIAB colour" })).toBe("Overlay, BIAB colour");
    expect(bookedName({ name: "Pedicure" })).toBe("Pedicure");
  });
});

describe("parseMenu", () => {
  it("is null for no menu, so the flat list is used", () => {
    expect(parseMenu(null)).toBeNull();
    expect(parseMenu([])).toBeNull();
    expect(parseMenu({})).toBeNull();
  });

  it("keeps a good menu as it is", () => {
    expect(parseMenu(JSON.parse(JSON.stringify(menu)))).toEqual(menu);
  });

  it("drops what cannot be booked, and makes the first finish the included one", () => {
    const m = parseMenu({
      treatments: [
        {
          id: "x",
          name: " Gel ",
          kinds: [{ name: "Manicure", durationMinutes: 45, priceMinor: "1500" }, { name: "", durationMinutes: 30 }, { name: "Long", durationMinutes: 0 }],
          finishes: [{ name: "Colour", priceMinor: 300, minutes: 5 }, { name: "colour" }, { name: "Chrome", priceMinor: -1, minutes: 10 }],
          extras: ["gone", "art"],
        },
        { id: "Bad Id", name: "No", kinds: [], finishes: [], extras: [] },
      ],
      extras: [{ id: "art", name: "Art", durationMinutes: 10, priceMinor: null }],
    })!;
    expect(m.treatments).toHaveLength(1);
    expect(m.treatments[0]).toEqual({
      id: "x",
      name: "Gel",
      kinds: [{ name: "Manicure", durationMinutes: 45, priceMinor: 1500 }],
      finishes: [
        { name: "Colour", priceMinor: 0, minutes: 0 },
        { name: "Chrome", priceMinor: 0, minutes: 10 },
      ],
      extras: ["art"],
    });
  });

  it("forgets a rebook into a kind that has gone", () => {
    const m = parseMenu({
      treatments: [{ id: "a", name: "A", kinds: [{ name: "Set", durationMinutes: 60, priceMinor: null, rebookWeeks: 3, rebookAs: "Infill" }], finishes: [], extras: [] }],
      extras: [],
    })!;
    expect(m.treatments[0].kinds[0]).toEqual({ name: "Set", durationMinutes: 60, priceMinor: null, rebookWeeks: 3 });
  });
});

describe("menuFromServices", () => {
  const flat = parseServices([
    { name: "Gel manicure", durationMinutes: 45, priceMinor: 2500, rebookWeeks: 3 },
    { name: "BIAB new set", durationMinutes: 60, priceMinor: 3500, rebookWeeks: 3, rebookAs: "BIAB infill" },
    { name: "BIAB infill", durationMinutes: 60, priceMinor: 3000 },
    { name: "Consultation", durationMinutes: 15, priceMinor: null },
    { name: "Chrome", durationMinutes: 10, priceMinor: 500, extra: true },
  ]);

  it("puts each service under its diary colour, with nothing else to choose", () => {
    const m = menuFromServices(flat);
    expect(m.treatments.map((t) => [t.name, t.kinds.map((k) => k.name)])).toEqual([
      ["Manicures", ["Gel manicure"]],
      ["Sets & infills", ["BIAB new set", "BIAB infill"]],
      ["Other", ["Consultation"]],
    ]);
    expect(m.treatments.every((t) => t.finishes.length === 0)).toBe(true);
    expect(m.extras.map((e) => e.name)).toEqual(["Chrome"]);
  });

  it("gives back the same list when flattened, so saving it changes nothing that books", () => {
    const again = flattenMenu(menuFromServices(flat));
    const strip = (l: typeof flat) =>
      l.map(({ name, durationMinutes, priceMinor, rebookWeeks, rebookAs, extra }) => ({ name, durationMinutes, priceMinor, rebookWeeks, rebookAs, extra }));
    expect(strip(again).sort((a, b) => a.name.localeCompare(b.name))).toEqual(strip(flat).sort((a, b) => a.name.localeCompare(b.name)));
  });
});

describe("menuOf", () => {
  it("prefers the saved menu, else makes one from the services", () => {
    expect(menuOf({ menu, services: [] })).toEqual(menu);
    expect(menuOf({ menu: null, services: [{ name: "Gel manicure", durationMinutes: 45 }] }).treatments[0].kinds[0].name).toBe("Gel manicure");
    expect(menuOf(null)).toEqual({ treatments: [], extras: [] });
  });
});

describe("the starter menu", () => {
  it("parses as it is, with no name made twice", () => {
    expect(parseMenu(JSON.parse(JSON.stringify(STARTER_MENU)))).toEqual(STARTER_MENU);
    expect(clashingNames(STARTER_MENU)).toEqual([]);
  });

  it("books the salon's own menu", () => {
    const names = flattenMenu(STARTER_MENU).map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Acrylic full set, gel colour",
        "Acrylic take off & redo, French tip",
        "BIAB infill, colour",
        "Manicure, normal colour",
        "Pedicure, French tip",
        "Toenail colour change",
        "Acrylic take off",
        "Nail art, tier 3",
      ])
    );
  });
});

describe("clashingNames", () => {
  it("names what two treatments would both book", () => {
    const m = structuredClone(menu);
    m.treatments[1].kinds[0].name = "Acrylic infill";
    m.treatments[1].finishes = [{ name: "Gel colour", priceMinor: 0, minutes: 0 }];
    expect(clashingNames(m)).toEqual(["Acrylic infill, gel colour"]);
  });
});

describe("uniqueId", () => {
  it("numbers a name already taken", () => {
    expect(uniqueId("BIAB", [])).toBe("biab");
    expect(uniqueId("BIAB", ["biab", "biab-2"])).toBe("biab-3");
  });
});

describe("what books from the flat list", () => {
  const flat = flattenMenu(menu);

  it("tells the bots extras go on top of a treatment, and which are priced from a photo", async () => {
    const { describeServicesForPrompt } = await import("@/lib/salon-config");
    const text = describeServicesForPrompt(flat);
    const [main, extras] = text.split("\n\n");
    expect(main).toContain("- Acrylic infill, French tip — about 1h 10m, from £33");
    expect(main).not.toContain("Nail art");
    expect(extras).toContain("never booked on their own");
    expect(extras).toContain("- Nail art, tier 2 — about 20 minutes, from £15 (priced from a photo of the design)");
  });

  it("never offers an extra on its own online", async () => {
    const { onlineServices } = await import("@/lib/online-booking/catalogue");
    const names = onlineServices(flat, [{ name: "Lan", workingDays: [], services: [], bookable: true }], []).map((s) => s.name);
    expect(names).toContain("Acrylic take off");
    expect(names).not.toContain("Nail art, tier 2");
  });
});

describe("addServicesToMenu", async () => {
  const { addServicesToMenu } = await import("./nail-menu");
  const read = parseServices([
    { name: "Acrylic take off", durationMinutes: 25, priceMinor: 1200 },
    { name: "Acrylic infill, gel colour", durationMinutes: 50, priceMinor: 9999 },
    { name: "Gel manicure", durationMinutes: 45, priceMinor: 2000 },
    { name: "Shellac manicure", durationMinutes: 40, priceMinor: null },
  ]);
  const next = addServicesToMenu(menu, read);

  it("updates a plain service the menu already has", () => {
    expect(next.treatments[1].kinds[0]).toMatchObject({ durationMinutes: 25, priceMinor: 1200 });
  });

  it("leaves a service made from a finish alone", () => {
    expect(next.treatments[0]).toEqual(menu.treatments[0]);
  });

  it("puts the rest under a treatment for their colour, made once", () => {
    expect(next.treatments.slice(2).map((t) => [t.name, t.kinds.map((k) => k.name)])).toEqual([
      ["Manicures", ["Gel manicure", "Shellac manicure"]],
    ]);
    expect(menu.treatments).toHaveLength(2);
  });
});
