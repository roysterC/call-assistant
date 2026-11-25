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
