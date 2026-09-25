/**
 * Availability, given somewhere to read busy time from.
 *
 * The Google and native diaries differ only in where a stylist's busy blocks
 * come from — a free/busy query, or our own appointments table. Everything
 * else (which service, who does it, the forward search, opening hours, lead
 * times) is the same rule and lives here once, so the two cannot drift.
 */

import { addCalendarDays, type BusinessHours } from "@/lib/business-hours";
import {
  matchStylist,
  resolveBookedService,
  stylistsForService,
  type SalonService,
  type Stylist,
} from "@/lib/salon-config";
import {
  computeForwardSlots,
  DEFAULT_SEARCH_DAYS,
  type StylistAvailability,
} from "../availability";
import { blockApplies, type BlockOccurrence } from "@/lib/time-blocks";
import type { AvailabilityQuery, TimeSlot } from "../types";

export interface DiaryConfig {
  timeZone: string;
  hours: BusinessHours;
  services: SalonService[];
  stylists: Stylist[];
}

/** Busy blocks for each of `pool` between `from` and `to`. */
export type LoadBusy = (
  pool: Stylist[],
  from: Date,
  to: Date
) => Promise<StylistAvailability[]>;

/** Blocked time (lunch, holidays, closures) between `from` and `to`. */
export type LoadBlocks = (from: Date, to: Date) => Promise<BlockOccurrence[]>;

const noBlocks: LoadBlocks = async () => [];

export async function readAvailability(
  cfg: DiaryConfig,
  q: AvailabilityQuery,
  loadBusy: LoadBusy,
  loadBlocks: LoadBlocks = noBlocks
): Promise<TimeSlot[]> {
  // Resolved the way a booking is, so "Full head colour + Cut and finish" is
  // one appointment of both lengths rather than a name no single service has.
  const resolved = resolveBookedService(q.serviceName, cfg.services);
  if (!resolved.ok) return [];
  const service = resolved.service;

  let pool = stylistsForService(service, cfg.stylists);
  const preferred = matchStylist(q.stylistName, cfg.stylists);
  if (preferred) {
    // Only if they actually do this service. This used to honour the name
    // regardless, on the reasoning that "I always see Jo" matters more than
    // a possibly-incomplete roster — which was right while the service lists
    // were guesses, and wrong once a salon sets them deliberately. A colour
    // specialist pinned to colour was still being booked for cuts.
    //
    // The handler checks this first and explains who does do it, so
    // returning nothing here is a backstop rather than the caller's answer.
    pool = pool.filter((s) => s.name === preferred.name);
  }
  if (pool.length === 0) return [];

  // Two weeks is the cap rather than the default: a search is only ever this
  // wide when the caller asked for the soonest.
  const searchDays = Math.min(Math.max(1, q.searchDays ?? 1), DEFAULT_SEARCH_DAYS);
  const lastDate = addCalendarDays(q.date, searchDays - 1);

  // Widen the window by a day either side so appointments that straddle
  // midnight in the salon's timezone are still seen.
  const from = new Date(new Date(`${q.date}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(new Date(`${lastDate}T00:00:00Z`).getTime() + 48 * 60 * 60 * 1000);

  const [loaded, blocks] = await Promise.all([
    loadBusy(pool, from, to),
    loadBlocks(from, to),
  ]);
  if (loaded.length === 0) return [];

  // Blocked time is busy time: it goes in beside the bookings, so every rule
  // that keeps a slot off a booking keeps it off lunch too.
  const candidates = loaded.map(({ stylist, busy }) => ({
    stylist,
    busy: [
      ...busy,
      ...blocks
        .filter((b) => blockApplies(b, stylist.name))
        .map((b) => ({ start: b.start, end: b.end })),
    ],
  }));

  return computeForwardSlots({
    fromDate: q.date,
    searchDays,
    timeZone: cfg.timeZone,
    hours: cfg.hours,
    service,
    candidates,
    clientType: q.clientType ?? "unknown",
  });
}
