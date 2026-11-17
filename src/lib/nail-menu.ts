/**
 * A nail salon's price list as the salon thinks of it: treatments (Acrylic,
 * BIAB, Pedicure…), each with its kinds (full set, infill), the finishes they
 * come in (gel colour, French tip) and the extras that can go on them (nail
 * art, a removal). Stored as `OrganizationSettings.menu`.
 *
 * Everything that books reads the flat list instead (`services`, parsed by
 * parseServices): the phone, the chats, online booking, the diary, rebooking
 * and sales all work in service names, and an appointment stores its
 * services as text. So the menu is the source and the flat list is made from
 * it on every save (flattenMenu): one service per kind and finish, named the
 * way it is said ("Acrylic infill, French tip"), and one per extra, marked
 * as an extra so it is only ever booked on top of a treatment.
 *
 * A salon with no menu saved (one set up before menus, or whose list was
 * last written as a flat list) is shown one made from its services
 * (menuFromServices): each service a kind of its own, grouped by its diary
 * colour, with the same names, so saving it changes nothing that books.
 */

import { classifyService, familyChoices } from "@/lib/service-colours";
import { parseServices, REBOOK_WEEKS_MAX, REBOOK_WEEKS_MIN, type SalonService } from "@/lib/salon-config";

/** One kind of a treatment, with its own length and price: "Full set", "Infill". */
export interface MenuKind {
  /** In full, as it is booked: "Acrylic infill". */
  name: string;
  durationMinutes: number;
  /** From-price in pence for the first finish; null until the salon sets one. */
  priceMinor: number | null;
  rebookWeeks?: number;
  /** Another kind of the same treatment they are due for instead: a full set's infill. */
  rebookAs?: string;
  requiresPatchTest?: boolean;
}

/** A finish the client picks one of. The first is what the price includes. */
export interface MenuFinish {
  name: string;
  /** Added to the kind's price, in pence. Always 0 for the first. */
  priceMinor: number;
  /** Added to the kind's length. Always 0 for the first. */
  minutes: number;
}

export interface MenuTreatment {
  id: string;
  /** A heading: "Acrylic". The kinds carry the names that are booked. */
  name: string;
  /** Its diary colour (service-colours.ts); unset means worked out from the names. */
  group?: string;
  kinds: MenuKind[];
  finishes: MenuFinish[];
  /** Ids of the extras that can go on it. */
  extras: string[];
}

/** Something added to a treatment, never booked alone: nail art, a removal. */
export interface MenuExtra {
  id: string;
  name: string;
  /** What it covers, for the desk and the bots: "Marble, chrome, charms". */
  note?: string;
  durationMinutes: number;
  priceMinor: number | null;
  /** Priced from a photo of the design: the price is a starting point. */
  photo?: boolean;
}

export interface SalonMenu {
  treatments: MenuTreatment[];
  extras: MenuExtra[];
}

const NAME_MAX = 80;
const NOTE_MAX = 160;
const ID_RE = /^[a-z0-9-]{1,40}$/;

const text = (v: unknown, max = NAME_MAX) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const minutesOf = (v: unknown, min: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= 12 * 60 ? n : null;
};
const penceOf = (v: unknown) => {
  if (v === null || v === "" || v === undefined) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * A stored menu, checked as the booking code needs it: anything malformed is
 * dropped rather than thrown, as parseServices does. Null when there is no
 * menu at all, so the caller falls back to the flat list.
 */
export function parseMenu(raw: unknown): SalonMenu | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as SalonMenu).treatments)) return null;
  const r = raw as { treatments: unknown[]; extras?: unknown };

  const extras: MenuExtra[] = [];
  for (const e of Array.isArray(r.extras) ? r.extras : []) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    const id = String(x.id ?? "");
    const name = text(x.name);
    const durationMinutes = minutesOf(x.durationMinutes, 0);
    if (!ID_RE.test(id) || !name || durationMinutes === null || extras.some((o) => o.id === id)) continue;
    const note = text(x.note, NOTE_MAX);
    extras.push({
      id,
      name,
      ...(note ? { note } : {}),
      durationMinutes,
      priceMinor: penceOf(x.priceMinor),
      ...(x.photo === true ? { photo: true } : {}),
    });
  }

  const treatments: MenuTreatment[] = [];
  for (const t of r.treatments) {
    if (!t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    const id = String(x.id ?? "");
    const name = text(x.name);
    if (!ID_RE.test(id) || !name || treatments.some((o) => o.id === id)) continue;

    const kinds: MenuKind[] = [];
    for (const k of Array.isArray(x.kinds) ? x.kinds : []) {
      if (!k || typeof k !== "object") continue;
      const y = k as Record<string, unknown>;
      const kname = text(y.name);
      const durationMinutes = minutesOf(y.durationMinutes, 1);
      if (!kname || durationMinutes === null || kinds.some((o) => o.name.toLowerCase() === kname.toLowerCase())) continue;
      const weeks = Number(y.rebookWeeks);
      const rebookWeeks = Number.isInteger(weeks) && weeks >= REBOOK_WEEKS_MIN && weeks <= REBOOK_WEEKS_MAX ? weeks : undefined;
      const rebookAs = rebookWeeks ? text(y.rebookAs) : "";
      kinds.push({
        name: kname,
        durationMinutes,
        priceMinor: penceOf(y.priceMinor),
        ...(rebookWeeks ? { rebookWeeks } : {}),
        ...(rebookAs ? { rebookAs } : {}),
        ...(y.requiresPatchTest === true ? { requiresPatchTest: true } : {}),
      });
    }
    // A rebook pointing at a kind since removed points at nothing.
    for (const k of kinds) {
      if (k.rebookAs && !kinds.some((o) => o.name.toLowerCase() === k.rebookAs!.toLowerCase())) delete k.rebookAs;
    }

    const finishes: MenuFinish[] = [];
    for (const f of Array.isArray(x.finishes) ? x.finishes : []) {
      if (!f || typeof f !== "object") continue;
      const y = f as Record<string, unknown>;
      const fname = text(y.name);
      if (!fname || finishes.some((o) => o.name.toLowerCase() === fname.toLowerCase())) continue;
      const first = finishes.length === 0;
      finishes.push({
        name: fname,
        priceMinor: first ? 0 : (penceOf(y.priceMinor) ?? 0),
        minutes: first ? 0 : (minutesOf(y.minutes, 0) ?? 0),
      });
    }

    const group = typeof x.group === "string" && /^[a-z]{2,20}$/.test(x.group) ? x.group : undefined;
    const on = Array.isArray(x.extras) ? x.extras.map(String) : [];
    treatments.push({
      id,
      name,
      ...(group ? { group } : {}),
      kinds,
      finishes,
      extras: extras.filter((e) => on.includes(e.id)).map((e) => e.id),
    });
  }

  return { treatments, extras };
}

/**
 * A finish as it reads after a comma: "Acrylic infill, gel colour". Its first
 * letter is lowered unless it starts a name or an abbreviation ("French tip",
 * "BIAB", "OPI").
 */
function finishWords(name: string): string {
  const first = name.split(" ")[0];
  if (first.length > 1 && first === first.toUpperCase()) return name;
  if (/^(French|Japanese|Russian)\b/.test(name)) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** The name a kind is booked under in a finish: "Acrylic infill, French tip". */
export function bookedName(kind: Pick<MenuKind, "name">, finish?: Pick<MenuFinish, "name"> | null): string {
  return finish ? `${kind.name}, ${finishWords(finish.name)}` : kind.name;
}

/** Where a booked name comes from on the menu. */
export type MenuPlace =
  | { type: "treatment"; treatmentId: string; kind: number; finish: number }
  | { type: "extra"; extraId: string };

/**
 * The flat list everything books from, and where on the menu each came from.
 * A name made twice (two treatments with the same kind and finish) is kept
 * once, as parseServices would.
 */
export function flattenMenuWithPlaces(menu: SalonMenu): { services: SalonService[]; places: Map<string, MenuPlace> } {
  const services: SalonService[] = [];
  const places = new Map<string, MenuPlace>();
  const add = (s: SalonService, place: MenuPlace) => {
    const key = s.name.toLowerCase();
    if (places.has(key)) return;
    places.set(key, place);
    services.push(s);
  };

  for (const t of menu.treatments) {
    const finishes: (MenuFinish | null)[] = t.finishes.length ? t.finishes : [null];
    t.kinds.forEach((k, ki) => {
      finishes.forEach((f, fi) => {
        const rebookKind = k.rebookAs ? t.kinds.find((o) => o.name.toLowerCase() === k.rebookAs!.toLowerCase()) : undefined;
        add(
          {
            name: bookedName(k, f),
            durationMinutes: k.durationMinutes + (f?.minutes ?? 0),
            requiresPatchTest: Boolean(k.requiresPatchTest),
            priceMinor: k.priceMinor === null ? null : k.priceMinor + (f?.priceMinor ?? 0),
            ...(k.rebookWeeks ? { rebookWeeks: k.rebookWeeks } : {}),
            ...(k.rebookWeeks && rebookKind ? { rebookAs: bookedName(rebookKind, f) } : {}),
            ...(t.group ? { group: t.group } : {}),
            treatment: t.name,
          },
          { type: "treatment", treatmentId: t.id, kind: ki, finish: f ? fi : -1 }
        );
      });
    });
  }

  for (const e of menu.extras) {
    add(
      {
        name: e.name,
        durationMinutes: Math.max(e.durationMinutes, 1),
        requiresPatchTest: false,
        priceMinor: e.priceMinor,
        extra: true,
        ...(e.photo ? { photoQuote: true } : {}),
      },
      { type: "extra", extraId: e.id }
    );
  }

  return { services: parseServices(services), places };
}

/** The flat list everything books from: see the header. */
export function flattenMenu(menu: SalonMenu): SalonService[] {
  return flattenMenuWithPlaces(menu).services;
}

/** The diary colours' names, as treatment headings for a menu made from a flat list. */
const FAMILY_HEADING: Record<string, string> = {
  manicure: "Manicures",
  pedicure: "Pedicures",
  enhancement: "Sets & infills",
  nailart: "Nail art & removals",
  other: "Other",
};

/**
 * A menu made from a flat list (see the header): every service a kind of its
 * own under its diary colour, no finishes, so flattening it gives back the
 * same names, lengths and prices. Services marked as extras stay extras.
 */
export function menuFromServices(services: SalonService[]): SalonMenu {
  const extras: MenuExtra[] = [];
  const byFamily = new Map<string, MenuKind[]>();
  for (const s of services) {
    if (s.extra) {
      extras.push({
        id: uniqueId(slug(s.name) || "extra", extras.map((e) => e.id)),
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceMinor: s.priceMinor,
        ...(s.photoQuote ? { photo: true } : {}),
      });
      continue;
    }
    const family = classifyService(s.name, s.requiresPatchTest, undefined, s.group);
    const list = byFamily.get(family) ?? [];
    list.push({
      name: s.name,
      durationMinutes: s.durationMinutes,
      priceMinor: s.priceMinor,
      ...(s.rebookWeeks ? { rebookWeeks: s.rebookWeeks } : {}),
      ...(s.rebookWeeks && s.rebookAs ? { rebookAs: s.rebookAs } : {}),
      ...(s.requiresPatchTest ? { requiresPatchTest: true } : {}),
    });
    byFamily.set(family, list);
  }

  const treatments: MenuTreatment[] = familyChoices()
    .filter((f) => byFamily.has(f))
    .map((f) => {
      const kinds = byFamily.get(f)!;
      // A rebook into another colour's service cannot be said within one treatment.
      for (const k of kinds) if (k.rebookAs && !kinds.some((o) => o.name === k.rebookAs)) delete k.rebookAs;
      return { id: f, name: FAMILY_HEADING[f] ?? f, ...(f === "other" ? {} : { group: f }), kinds, finishes: [], extras: [] };
    });
  return { treatments, extras };
}

/** The salon's menu: the one it saved, else one made from its services. */
export function menuOf(settings: { menu?: unknown; services?: unknown } | null | undefined): SalonMenu {
  return parseMenu(settings?.menu) ?? menuFromServices(parseServices(settings?.services));
}

export function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** `base`, or `base-2`, `base-3`… whichever is not taken. */
export function uniqueId(base: string, taken: string[]): string {
  const b = slug(base) || "item";
  if (!taken.includes(b)) return b;
  for (let n = 2; ; n++) if (!taken.includes(`${b}-${n}`)) return `${b}-${n}`;
}

/**
 * Names the menu would book under more than once: two treatments making
 * "Infill, colour". Only the first would be bookable, so the editor says so.
 */
export function clashingNames(menu: SalonMenu): string[] {
  const seen = new Map<string, number>();
  const all = [
    ...menu.treatments.flatMap((t) => t.kinds.flatMap((k) => (t.finishes.length ? t.finishes : [null]).map((f) => bookedName(k, f)))),
    ...menu.extras.map((e) => e.name),
  ];
  for (const n of all) seen.set(n.toLowerCase(), (seen.get(n.toLowerCase()) ?? 0) + 1);
  return all.filter((n, i) => seen.get(n.toLowerCase())! > 1 && all.findIndex((o) => o.toLowerCase() === n.toLowerCase()) === i);
}

/**
 * The demo salon's own menu (Nov 2026). Unpriced but for nail art, whose
 * tiers the menu priced; lengths are typical ones the salon changes.
 */
export const STARTER_MENU: SalonMenu = {
  treatments: [
    {
      id: "acrylic",
      name: "Acrylic",
      group: "enhancement",
      kinds: [
        { name: "Acrylic full set", durationMinutes: 75, priceMinor: null, rebookWeeks: 3, rebookAs: "Acrylic infill" },
        { name: "Acrylic infill", durationMinutes: 60, priceMinor: null, rebookWeeks: 3 },
        { name: "Acrylic take off & redo", durationMinutes: 90, priceMinor: null, rebookWeeks: 3, rebookAs: "Acrylic infill" },
      ],
      finishes: [
        { name: "Gel colour", priceMinor: 0, minutes: 0 },
        { name: "French tip", priceMinor: 0, minutes: 10 },
      ],
      extras: ["art-1", "art-2", "art-3"],
    },
    {
      id: "biab",
      name: "BIAB",
      group: "enhancement",
      kinds: [
        { name: "BIAB full set", durationMinutes: 60, priceMinor: null, rebookWeeks: 3, rebookAs: "BIAB infill" },
        { name: "BIAB infill", durationMinutes: 60, priceMinor: null, rebookWeeks: 3 },
      ],
      finishes: [
        { name: "Colour", priceMinor: 0, minutes: 0 },
        { name: "French tip", priceMinor: 0, minutes: 10 },
      ],
      extras: ["art-1", "art-2", "art-3", "gel-removal"],
    },
    {
      id: "gel",
      name: "Gel nails",
      group: "manicure",
      kinds: [{ name: "Manicure", durationMinutes: 45, priceMinor: null, rebookWeeks: 3 }],
      finishes: [
        { name: "No colour", priceMinor: 0, minutes: 0 },
        { name: "Normal colour", priceMinor: 0, minutes: 5 },
        { name: "Gel", priceMinor: 0, minutes: 10 },
      ],
      extras: ["art-1", "art-2", "art-3", "gel-removal"],
    },
    {
      id: "pedicure",
      name: "Pedicure",
      group: "pedicure",
      kinds: [{ name: "Pedicure", durationMinutes: 50, priceMinor: null, rebookWeeks: 4 }],
      finishes: [
        { name: "No colour", priceMinor: 0, minutes: 0 },
        { name: "Normal colour", priceMinor: 0, minutes: 5 },
        { name: "Gel colour", priceMinor: 0, minutes: 10 },
        { name: "French tip", priceMinor: 0, minutes: 15 },
      ],
      extras: ["gel-removal", "toenail-extension", "toenail-designs"],
    },
    {
      id: "toenails",
      name: "Toenails",
      group: "pedicure",
      kinds: [{ name: "Toenail colour change", durationMinutes: 20, priceMinor: null }],
      finishes: [],
      extras: ["toenail-designs"],
    },
    {
      id: "removals",
      name: "Removals",
      group: "nailart",
      kinds: [{ name: "Acrylic take off", durationMinutes: 30, priceMinor: null }],
      finishes: [],
      extras: [],
    },
  ],
  extras: [
    { id: "art-1", name: "Nail art, tier 1", note: "Simple designs on one or two accent nails", durationMinutes: 10, priceMinor: 500 },
    { id: "art-2", name: "Nail art, tier 2", note: "Marble, glitter inlay, chrome lines and swirls, charms", durationMinutes: 20, priceMinor: 1500, photo: true },
    { id: "art-3", name: "Nail art, tier 3", note: "Hand-painted on several or all nails, 3D art, rhinestones", durationMinutes: 40, priceMinor: 2500, photo: true },
    { id: "gel-removal", name: "Gel removal", note: "Soaked off before the treatment", durationMinutes: 15, priceMinor: null },
    { id: "toenail-extension", name: "Toenail extension", note: "Per toe", durationMinutes: 10, priceMinor: null },
    { id: "toenail-designs", name: "Toenail designs", durationMinutes: 15, priceMinor: null, photo: true },
  ],
};

/**
 * Services read from a photo of a price list (price-import.ts), added to the
 * menu: a name the menu already books as a plain service takes the new
 * length and price; anything else becomes a service of its own under the
 * treatment for its diary colour, made if there is none.
 */
export function addServicesToMenu(menu: SalonMenu, services: SalonService[]): SalonMenu {
  const next = structuredClone(menu);
  const { places } = flattenMenuWithPlaces(next);
  for (const s of services) {
    const place = places.get(s.name.toLowerCase());
    if (place?.type === "treatment" && place.finish === -1) {
      const k = next.treatments.find((t) => t.id === place.treatmentId)!.kinds[place.kind];
      k.durationMinutes = s.durationMinutes;
      if (s.priceMinor !== null) k.priceMinor = s.priceMinor;
      continue;
    }
    if (place) continue;
    const family = classifyService(s.name, s.requiresPatchTest, undefined, s.group);
    let t = next.treatments.find((x) => (x.group ?? "other") === family && x.finishes.length === 0);
    if (!t) {
      t = {
        id: uniqueId(FAMILY_HEADING[family] ?? family, next.treatments.map((x) => x.id)),
        name: FAMILY_HEADING[family] ?? family,
        ...(family === "other" ? {} : { group: family }),
        kinds: [],
        finishes: [],
        extras: [],
      };
      next.treatments.push(t);
    }
    t.kinds.push({ name: s.name, durationMinutes: s.durationMinutes, priceMinor: s.priceMinor });
    places.set(s.name.toLowerCase(), { type: "treatment", treatmentId: t.id, kind: t.kinds.length - 1, finish: -1 });
  }
  return next;
}
