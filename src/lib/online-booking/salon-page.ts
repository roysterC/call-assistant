/**
 * What the salon's own page (components/online-booking/salon-site.tsx) works
 * out from its settings: whether it is open right now, the hours as people
 * write them, the treatments as tiles, and the few facts across the top.
 * Kept here, apart from the page, so it can be tested.
 */

import { hoursForWeekday, toMinutes, zonedParts, type BusinessHours, type DayHours } from "@/lib/business-hours";
import type { PublicService } from "./catalogue";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, as a week is read in the UK. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

const isOpen = (h: DayHours | null): h is DayHours => Boolean(h && !h.closed && h.open && h.close);

/** "10:00" → "10am", "19:30" → "7:30pm". */
export function clockText(hhmm: string): string {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** "10am – 7pm", or "Closed". */
export function dayHoursText(h: DayHours | null): string {
  return isOpen(h) ? `${clockText(h.open)} – ${clockText(h.close)}` : "Closed";
}

/**
 * Whether the salon is open at `now`, in its own timezone, as one short line:
 * "Open now, until 7pm", "Opens today at 10am", "Opens Wednesday at 10am".
 * Null when no hours are set.
 */
export function openStatus(
  hours: BusinessHours,
  timeZone: string,
  now: Date = new Date()
): { open: boolean; text: string } | null {
  if (!hours.some((h) => isOpen(h))) return null;
  const p = zonedParts(now, timeZone);
  const mins = p.hour * 60 + p.minute;
  const today = hoursForWeekday(hours, p.weekday);
  if (isOpen(today)) {
    if (mins >= toMinutes(today.open) && mins < toMinutes(today.close)) {
      return { open: true, text: `Open now, until ${clockText(today.close)}` };
    }
    if (mins < toMinutes(today.open)) return { open: false, text: `Opens today at ${clockText(today.open)}` };
  }
  for (let i = 1; i <= 7; i++) {
    const day = (p.weekday + i) % 7;
    const h = hoursForWeekday(hours, day);
    if (isOpen(h)) {
      return { open: false, text: `Opens ${i === 1 ? "tomorrow" : DAY_NAMES[day]} at ${clockText(h.open)}` };
    }
  }
  return null;
}

/** The week, Monday first, with today marked. */
export function weekHours(
  hours: BusinessHours,
  timeZone: string,
  now: Date = new Date()
): { day: string; text: string; closed: boolean; today: boolean }[] {
  const today = zonedParts(now, timeZone).weekday;
  return WEEK.map((d) => {
    const h = hoursForWeekday(hours, d);
    return { day: DAY_NAMES[d], text: dayHoursText(h), closed: !isOpen(h), today: d === today };
  });
}

/** Which drawing a treatment's tile gets, from its name. */
export type TileArt = "biab" | "gel" | "acrylic" | "pedicure" | "art" | "other";

export function artFor(name: string): TileArt {
  const n = name.toLowerCase();
  if (/pedi|toe|feet|foot/.test(n)) return "pedicure";
  if (/biab|builder|overlay|structured/.test(n)) return "biab";
  if (/acrylic|extension|sculpt|tips|sns|gel-?x|press/.test(n)) return "acrylic";
  if (/gel|polish|mani|shellac|french/.test(n)) return "gel";
  if (/art|design/.test(n)) return "art";
  return "other";
}

export interface TreatmentTile {
  name: string;
  art: TileArt;
  /** How many services it holds, for "3 options". */
  count: number;
  /** Where the tile goes: straight to the one service, or to choosing among the treatment's. */
  query: { treatment: string } | { service: string };
}

/**
 * One tile per treatment, in menu order. A salon whose services have no
 * treatments (a flat price list) gets one tile per service instead.
 */
export function treatmentTiles(services: PublicService[]): TreatmentTile[] {
  const tiles: TreatmentTile[] = [];
  const byTreatment = new Map<string, PublicService[]>();
  for (const s of services) {
    const key = s.treatment?.trim() || "";
    if (!byTreatment.has(key)) byTreatment.set(key, []);
    byTreatment.get(key)!.push(s);
  }
  for (const [treatment, list] of byTreatment) {
    if (!treatment) {
      for (const s of list) tiles.push({ name: s.name, art: artFor(s.name), count: 1, query: { service: s.name } });
      continue;
    }
    tiles.push({
      name: treatment,
      art: artFor(treatment),
      count: list.length,
      query: list.length === 1 ? { service: list[0].name } : { treatment },
    });
  }
  return tiles;
}

/** The lowest list price and what it is for, for "From £28". */
export function lowestPrice(services: PublicService[]): { minor: number; service: string } | null {
  let best: { minor: number; service: string } | null = null;
  for (const s of services) {
    if (s.priceMinor !== null && (!best || s.priceMinor < best.minor)) best = { minor: s.priceMinor, service: s.name };
  }
  return best;
}

/** "Open 6 days" and which day it shuts, or "Open every day". */
export function openDaysText(hours: BusinessHours): { title: string; detail: string } | null {
  const open = WEEK.filter((d) => isOpen(hoursForWeekday(hours, d)));
  if (open.length === 0) return null;
  if (open.length === 7) return { title: "Open every day", detail: "Seven days a week" };
  const shut = WEEK.filter((d) => !open.includes(d)).map((d) => `${DAY_NAMES[d]}s`);
  const list = shut.length === 1 ? shut[0] : `${shut.slice(0, -1).join(", ")} and ${shut[shut.length - 1]}`;
  return { title: `Open ${open.length} days`, detail: `Closed ${list}` };
}

/**
 * Where the page's "Got a design in mind?" sends a photo: the salon's
 * Instagram, else its WhatsApp (receptionist/design-chats.ts, which the
 * phone receptionist reads too). Null when it takes messages on neither.
 */
export function designMessageLink(
  chats: { instagram: string | null; whatsapp: { number: string } | null } | null
): { label: string; href: string } | null {
  if (chats?.instagram) {
    return { label: `Message @${chats.instagram}`, href: `https://ig.me/m/${encodeURIComponent(chats.instagram)}` };
  }
  if (chats?.whatsapp) {
    return { label: "Message us on WhatsApp", href: `https://wa.me/${chats.whatsapp.number.replace(/\D/g, "")}` };
  }
  return null;
}

/**
 * The accent for stickers and the underline on the salon's page: orange,
 * unless the salon's own colour is already red, orange or yellow, when
 * orange would clash or vanish, so cream instead.
 */
export function accentFor(brandHex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(brandHex.trim());
  if (!m) return "#ff8748";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  // Greys and near-greys have no hue to clash with.
  if (d < 0.08) return "#ff8748";
  let hue: number;
  if (max === r) hue = (((g - b) / d) % 6) * 60;
  else if (max === g) hue = ((b - r) / d + 2) * 60;
  else hue = ((r - g) / d + 4) * 60;
  if (hue < 0) hue += 360;
  return hue < 65 || hue > 330 ? "#fff4e8" : "#ff8748";
}

/** One answer to "Not sure what to book?", pointing at a treatment the salon offers. */
export interface NailGoal {
  art: TileArt;
  /** What the client wants, in their words. */
  goal: string;
  /** What the treatment is, in plain English. */
  why: string;
  /** The salon's own name for it ("BIAB", "Builder gel"). */
  name: string;
  /** Where "Book" goes: as a treatment tile does. */
  query: TreatmentTile["query"];
  /** The lowest price among its options, in pence, if any are priced. */
  fromMinor: number | null;
  /** The shortest of its options, in minutes. */
  minutes: number;
}

const GOALS: { art: TileArt; goal: string; why: string }[] = [
  {
    art: "biab",
    goal: "Strong nails while mine grow",
    why: "A builder gel overlay that protects your own nails so they can grow without snapping. Most people come back for an infill every 3 to 4 weeks.",
  },
  {
    art: "gel",
    goal: "Colour that won’t chip for weeks",
    why: "Any colour you like, set hard under a lamp. Dry the moment you leave and chip-free for two to three weeks.",
  },
  {
    art: "acrylic",
    goal: "Length or a shape I don’t have",
    why: "Extensions built on top of your own nails and shaped how you want them: almond, square, coffin or stiletto.",
  },
  {
    art: "art",
    goal: "Something nobody else has",
    why: "Designs painted by hand. Bring a photo, or tell us a mood and we’ll work something out with you.",
  },
  {
    art: "pedicure",
    goal: "Feet ready to show off",
    why: "A soak, file, hard-skin care and polish, so your feet feel as good as they look.",
  },
];

/**
 * The plain-English chooser on the salon's page, built from what the salon
 * actually offers: one goal per kind of treatment it has, in the salon's own
 * words and prices. Empty when fewer than two kinds would show, as a choice
 * of one helps nobody.
 */
export function nailGoals(services: PublicService[]): NailGoal[] {
  const tiles = treatmentTiles(services);
  const out: NailGoal[] = [];
  for (const g of GOALS) {
    const tile = tiles.find((t) => t.art === g.art);
    if (!tile) continue;
    const q = tile.query;
    const pool =
      "treatment" in q
        ? services.filter((s) => s.treatment?.trim() === q.treatment)
        : services.filter((s) => s.name === q.service);
    if (pool.length === 0) continue;
    const priced = pool.map((s) => s.priceMinor).filter((p): p is number => p !== null);
    out.push({
      ...g,
      name: tile.name,
      query: tile.query,
      fromMinor: priced.length ? Math.min(...priced) : null,
      minutes: Math.min(...pool.map((s) => s.durationMinutes)),
    });
  }
  return out.length >= 2 ? out : [];
}

/** The services under their treatment headings, in menu order, for the price list. */
export function menuGroups(services: PublicService[]): { heading: string | null; services: PublicService[] }[] {
  const groups: { heading: string | null; services: PublicService[] }[] = [];
  for (const s of services) {
    const heading = s.treatment?.trim() || null;
    const g = groups.find((x) => x.heading === heading);
    if (g) g.services.push(s);
    else groups.push({ heading, services: [s] });
  }
  // Unheaded services go last, under "More", when anything else has a heading.
  const loose = groups.findIndex((g) => g.heading === null);
  if (loose >= 0 && groups.length > 1) {
    const [g] = groups.splice(loose, 1);
    groups.push({ heading: "More", services: g.services });
  }
  return groups;
}
