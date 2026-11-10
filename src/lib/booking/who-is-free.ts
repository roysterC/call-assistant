/**
 * Who is free now, for a salon: loads today's diary and hands it to
 * whoIsFree (free-now.ts). Used by the Diary's "Who's free" panel
 * (api/diary/free-now) and the assistant's who_is_free_now.
 */

import { prisma } from "@/lib/prisma";
import { getSalonConfig } from "@/lib/booking";
import { blocksBetween } from "@/lib/booking/diary";
import { googleBusyByStylist } from "@/lib/booking/providers/google";
import { whoIsFree, type BusyStretch, type WhoIsFree } from "@/lib/booking/free-now";
import { zonedDateString, zonedDayBounds } from "@/lib/business-hours";
import { resolveBookedService } from "@/lib/salon-config";
import { blockApplies } from "@/lib/time-blocks";

export type WhoIsFreeResult =
  | (WhoIsFree & { timeZone: string; service: { name: string; durationMinutes: number } | null; warning?: string })
  | { error: string };

export async function whoIsFreeAt(
  organizationId: string,
  opts: { service?: string | null; now?: Date } = {}
): Promise<WhoIsFreeResult> {
  const now = opts.now ?? new Date();
  const cfg = await getSalonConfig(organizationId);
  const tz = cfg.timeZone;

  let service = null;
  if (opts.service?.trim()) {
    const resolved = resolveBookedService(opts.service, cfg.services);
    if (!resolved.ok) return { error: `"${opts.service}" is not one of the salon's services.` };
    service = resolved.service;
  }

  const { start: dayStart, end: dayEnd } = zonedDayBounds(zonedDateString(now, tz), tz);
  const [appointments, blocks] = await Promise.all([
    // Booked only: one marked done or a no-show has left the chair.
    prisma.appointment.findMany({
      where: { organizationId, status: "booked", startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      select: { stylistName: true, startsAt: true, endsAt: true, serviceText: true, lead: { select: { name: true } } },
    }),
    blocksBetween(prisma, organizationId, dayStart, dayEnd, tz),
  ]);

  const busy = new Map<string, BusyStretch[]>();
  const add = (name: string, b: BusyStretch) => {
    const key = name.toLowerCase();
    busy.set(key, [...(busy.get(key) ?? []), b]);
  };
  for (const a of appointments) {
    add(a.stylistName, { start: a.startsAt, end: a.endsAt, what: [a.lead?.name, a.serviceText].filter(Boolean).join(", ") });
  }
  for (const s of cfg.stylists) {
    for (const b of blocks.filter((b) => blockApplies(b, s.name))) {
      add(s.name, { start: b.start, end: b.end, what: b.label || "Blocked", allDay: b.allDay });
    }
  }

  // On a Google diary, what is in their calendars counts too.
  let warning: string | undefined;
  if (cfg.diary === "google") {
    try {
      for (const [key, list] of await googleBusyByStylist(cfg.stylists, dayStart, dayEnd)) {
        busy.set(key, [...(busy.get(key) ?? []), ...list.map((b) => ({ start: b.start, end: b.end, what: null }))]);
      }
    } catch (err) {
      console.error("[FREE NOW] Google calendars unreadable:", err);
      warning = "The Google calendars could not be read, so only bookings made here are counted.";
    }
  }

  const result = whoIsFree({ now, timeZone: tz, hours: cfg.hours, stylists: cfg.stylists, busy, service });
  return {
    ...result,
    timeZone: tz,
    service: service ? { name: service.name, durationMinutes: service.durationMinutes } : null,
    ...(warning ? { warning } : {}),
  };
}
