/**
 * Shogo's official price list, hours and notes, from the printed list at the
 * salon (September 2026). Used by scripts/apply-shogo-menu.ts to put them on a
 * live database, and by scripts/seed-salon.ts for local development.
 *
 * The printed list gives prices but not how long anything takes, and the
 * diary needs a length to know how much of a stylist's day to block. The
 * durations below are our estimates: Shogo should check them in Settings.
 *
 * Prices on the list are "from" prices, and that is how the bots quote them.
 * Children's cuts are fixed prices; the FAQ says so.
 */

export const SHOGO_CONTACT_PHONE = "020 7431 7546";

// 0 = Sunday. Tue, Wed, Fri, Sat 10-7; Thursday 11-7; Sunday 11-6; Monday closed.
export const SHOGO_HOURS = [
  { day: 0, closed: false, open: "11:00", close: "18:00" },
  { day: 1, closed: true, open: "", close: "" },
  { day: 2, closed: false, open: "10:00", close: "19:00" },
  { day: 3, closed: false, open: "10:00", close: "19:00" },
  { day: 4, closed: false, open: "11:00", close: "19:00" },
  { day: 5, closed: false, open: "10:00", close: "19:00" },
  { day: 6, closed: false, open: "10:00", close: "19:00" },
];

const svc = (
  name: string,
  pounds: number,
  durationMinutes: number,
  opts: { patch?: boolean; buffer?: number } = {}
) => ({
  name,
  durationMinutes,
  requiresPatchTest: opts.patch ?? false,
  bufferMinutes: opts.buffer ?? 0,
  priceMinor: Math.round(pounds * 100),
});

// "and" rather than "&": the receptionist reads these aloud.
export const SHOGO_SERVICES = [
  // Cut services
  svc("Ladies cut and blow dry", 59, 60),
  svc("Men's cut and dry", 42, 30),
  // Wash and blow dry
  svc("Wash and blow dry, short hair", 29, 30),
  svc("Wash and blow dry, medium hair", 34, 45),
  svc("Wash and blow dry, long hair", 39, 45),
  // Colour services: a skin test 48 hours ahead for anyone new.
  svc("Roots colour", 49, 90, { patch: true, buffer: 15 }),
  svc("Full colour, short hair", 59, 90, { patch: true, buffer: 15 }),
  svc("Full colour, medium hair", 65, 105, { patch: true, buffer: 15 }),
  svc("Full colour, long hair", 69, 120, { patch: true, buffer: 15 }),
  // Highlight services
  svc("Highlights, top", 60, 90, { patch: true, buffer: 15 }),
  svc("Highlights, half head", 79, 120, { patch: true, buffer: 15 }),
  svc("Highlights, full head", 99, 150, { patch: true, buffer: 15 }),
  // Treatments
  svc("Yuko straightening", 190, 240, { buffer: 15 }),
  svc("Keratin treatment", 150, 180, { buffer: 15 }),
  svc("Olaplex treatment", 30, 30),
  // Hair up and bridal
  svc("Hair up, party style", 45, 60),
  svc("Bridal hair", 180, 120),
  // Children's haircuts (fixed prices)
  svc("Children's cut, age 0 to 6", 19, 30),
  svc("Children's cut, age 7 to 12", 27, 30),
  svc("Children's cut, age 13 to 16", 32, 30),
];

/** The notes on the list, and the prices that are add-ons rather than services. */
export const SHOGO_FAQ = [
  "Address: 106 Heath Street, Hampstead, London NW3 1DR.",
  `Phone: ${SHOGO_CONTACT_PHONE}.`,
  "Skin test: needed at least 48 hours before any colouring service.",
  "Blow drying is not included in colour or treatment services unless a professional blow dry is booked, at extra charge.",
  "Prices are \"from\" prices and may vary with technique, hair type and length of appointment.",
  "Roots colour is for regrowth within 7 weeks of the last colour.",
  "Olaplex can be added to any colour for £15 extra.",
  "Hair up with a shampoo is £10 extra.",
  "Bridal hair at the venue rather than in the salon is £60 per hour on top; take their details so the salon can arrange it.",
  "Children's haircuts are fixed prices, not \"from\": age 0 to 6 £19, age 7 to 12 £27, age 13 to 16 £32.",
  "Student discount: 15% off cuts only.",
].join("\n");

/**
 * Where each service on the old list went, for stylists who only do some
 * services. A name with nowhere to go (fringe trim, balayage, toner) is not
 * on the official list, so it is dropped from their list.
 */
export const OLD_TO_NEW: Record<string, string[]> = {
  "cut and finish": ["Ladies cut and blow dry"],
  restyle: ["Ladies cut and blow dry"],
  "gents cut": ["Men's cut and dry"],
  "blow dry": ["Wash and blow dry, short hair", "Wash and blow dry, medium hair", "Wash and blow dry, long hair"],
  "root tint": ["Roots colour"],
  "full head colour": ["Full colour, short hair", "Full colour, medium hair", "Full colour, long hair"],
  "half head highlights": ["Highlights, top", "Highlights, half head"],
  "full head highlights": ["Highlights, full head"],
  "olaplex treatment": ["Olaplex treatment"],
  "bridal and occasion hair": ["Bridal hair", "Hair up, party style"],
  "children under twelve": ["Children's cut, age 0 to 6", "Children's cut, age 7 to 12"],
};

/** A stylist's services on the new list. Empty in means "does everything", and stays so. */
export function remapStylistServices(services: string[]): { services: string[]; dropped: string[] } {
  if (services.length === 0) return { services: [], dropped: [] };
  const current = new Set(SHOGO_SERVICES.map((s) => s.name.toLowerCase()));
  const out: string[] = [];
  const dropped: string[] = [];
  for (const name of services) {
    const key = name.trim().toLowerCase();
    const mapped = current.has(key)
      ? [SHOGO_SERVICES.find((s) => s.name.toLowerCase() === key)!.name]
      : OLD_TO_NEW[key];
    if (!mapped) dropped.push(name);
    for (const m of mapped ?? []) if (!out.includes(m)) out.push(m);
  }
  return { services: out, dropped };
}
