/**
 * Who is free now: for each of the team, what they are doing this minute and
 * when they are next free today. For a walk-in at the desk ("can anyone do
 * my nails now?") and for whoever answers the phone to "can I come in now?".
 *
 * Plain arithmetic on what the diary holds (who-is-free.ts loads it), so it
 * runs the same in tests as at the desk. Unlike a booking's free times there
 * is no two-hour notice: the client is standing there.
 */

import { openWindowFor, zonedDateString, zonedParts, type BusinessHours } from "@/lib/business-hours";
import { isBookable, stylistsForService, stylistWorksOn, type SalonService, type Stylist } from "@/lib/salon-config";

/** A stretch someone is taken: an appointment ("Mai Tran, BIAB infill") or blocked time ("Lunch"). */
export interface BusyStretch {
  start: Date;
  end: Date;
  what?: string | null;
  /** Blocked for the whole day: they are not in. */
  allDay?: boolean;
}

export interface PersonFree {
  name: string;
  /** Rostered today and not blocked for the whole of it. */
  working: boolean;
  /** What they are doing this minute, if anything, and until when (back-to-back counts as one). */
  busyNow: { until: Date; what: string | null } | null;
  /** Their first free stretch from now, of at least MIN_FREE_MINUTES; null when booked up for the day. */
  nextFree: { start: Date; end: Date } | null;
  /** With a service asked for: the soonest they could start it today, or null. */
  canStartAt?: Date | null;
}

export interface WhoIsFree {
  /** The salon is shut all day today. */
  closedToday: boolean;
  /** Open today, but closed for the rest of it. */
  closedNow: boolean;
  /** Opening and closing today, when open. */
  open: { start: Date; end: Date } | null;
  /** Soonest free first; booked-up and not-in last. */
  people: PersonFree[];
}

/** A gap shorter than this is not worth offering anyone. */
export const MIN_FREE_MINUTES = 15;
/** Times are offered on the five minutes: "free from 10:35", never 10:32. */
const STEP_MS = 5 * 60_000;
const MINUTE = 60_000;

export function whoIsFree(input: {
  now: Date;
  timeZone: string;
  hours: BusinessHours;
  stylists: Stylist[];
  /** Busy time per person, keyed by name in lower case. */
  busy: Map<string, BusyStretch[]>;
  /** Only those who do this, with when each could start it. */
  service?: SalonService | null;
}): WhoIsFree {
  const { now, timeZone, hours, service } = input;
  const today = zonedDateString(now, timeZone);
  const window = openWindowFor(hours, timeZone, today);
  if (!window) return { closedToday: true, closedNow: true, open: null, people: [] };

  const from = new Date(Math.max(Math.ceil(now.getTime() / STEP_MS) * STEP_MS, window.start.getTime()));
  const closedNow = from >= window.end;
  const weekday = zonedParts(now, timeZone).weekday;
  const team = service ? stylistsForService(service, input.stylists) : input.stylists.filter(isBookable);

  const people = team.map((stylist): PersonFree => {
    const mine = input.busy.get(stylist.name.toLowerCase()) ?? [];
    const working = stylistWorksOn(stylist, weekday) && !mine.some((b) => b.allDay);
    if (!working || closedNow) {
      return { name: stylist.name, working, busyNow: null, nextFree: null, ...(service ? { canStartAt: null } : {}) };
    }

    const merged = merge(mine.filter((b) => b.end > now && b.start < window.end));
    const current = merged.find((m) => m.start <= now && now < m.end);
    const busyNow = current
      ? { until: current.end, what: mine.find((b) => b.start <= now && now < b.end)?.what ?? null }
      : null;

    const free = freeStretches(merged, from, window.end);
    const fits = service && free.find((f) => f.end.getTime() - f.start.getTime() >= service.durationMinutes * MINUTE);
    return {
      name: stylist.name,
      working,
      busyNow,
      nextFree: free[0] ?? null,
      ...(service ? { canStartAt: fits ? fits.start : null } : {}),
    };
  });

  // Free soonest first, then booked up for the day, then not in.
  const BOOKED_UP = Number.MAX_SAFE_INTEGER - 1;
  const soonest = (p: PersonFree) =>
    !p.working
      ? Number.MAX_SAFE_INTEGER
      : ((service ? p.canStartAt : p.nextFree?.start)?.getTime() ?? BOOKED_UP);
  people.sort((a, b) => soonest(a) - soonest(b) || a.name.localeCompare(b.name));

  return { closedToday: false, closedNow, open: window, people };
}

/** Overlapping and back-to-back stretches as one: two clients in a row is one busy stretch. */
function merge(stretches: BusyStretch[]): Array<{ start: Date; end: Date }> {
  const sorted = [...stretches].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Array<{ start: Date; end: Date }> = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else {
      out.push({ start: s.start, end: s.end });
    }
  }
  return out;
}

/** The gaps between `from` and `to`, on the five minutes, of at least MIN_FREE_MINUTES. */
function freeStretches(busy: Array<{ start: Date; end: Date }>, from: Date, to: Date) {
  const out: Array<{ start: Date; end: Date }> = [];
  let cursor = from;
  for (const b of [...busy, { start: to, end: to }]) {
    const until = b.start < to ? b.start : to;
    if (until.getTime() - cursor.getTime() >= MIN_FREE_MINUTES * MINUTE) out.push({ start: cursor, end: until });
    if (b.end > cursor) cursor = new Date(Math.ceil(b.end.getTime() / STEP_MS) * STEP_MS);
    if (cursor >= to) break;
  }
  return out;
}
