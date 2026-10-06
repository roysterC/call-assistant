/**
 * What the personal assistant can tell you: the day, a client, the phone's
 * messages, the takings. Read-only; nothing here changes anything.
 */

import { prisma } from "@/lib/prisma";
import { getSalonConfig, type SalonConfig } from "@/lib/booking";
import { blocksBetween } from "@/lib/booking/diary";
import {
  hoursForWeekday,
  parseDateOnly,
  resolveSpokenDate,
  zonedDateString,
  zonedParts,
  zonedWallTimeToUtc,
} from "@/lib/business-hours";
import { describePeriod, resolvePeriod, shiftPeriod, type PeriodKind } from "@/lib/sales-period";
import { computeTakings } from "@/lib/takings";
import type { Asker } from "./drafts";

const clock = (at: Date, tz: string) =>
  at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
const pounds = (minor: number) => `£${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: minor % 100 ? 2 : 0 })}`;

// --- The day ----------------------------------------------------------------------------

/**
 * A day in the diary: each person's appointments, and the stretches of an
 * hour or more they have free, inside the salon's hours and their own days.
 */
export async function daySchedule(asker: Asker, input: { date?: string; stylist?: string }) {
  const cfg = await getSalonConfig(asker.organizationId);
  const tz = cfg.timeZone;
  const date = input.date ? resolveSpokenDateOrToday(input.date, tz) : zonedDateString(new Date(), tz);
  if (!date) return { error: `"${input.date}" is not a day I can place.` };
  const d = parseDateOnly(date);
  const dayStart = zonedWallTimeToUtc(d.year, d.month, d.day, 0, 0, tz);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const weekday = zonedParts(new Date(dayStart.getTime() + 12 * 3600_000), tz).weekday;
  const hours = hoursForWeekday(cfg.hours, weekday);
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  if (!hours || hours.closed) return { date: label, closed: true };

  const people = cfg.stylists.filter(
    (s) => !input.stylist || s.name.toLowerCase().startsWith(input.stylist.trim().toLowerCase())
  );
  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        organizationId: asker.organizationId,
        startsAt: { gte: dayStart, lt: dayEnd },
        status: { in: ["booked", "completed", "no_show"] },
      },
      include: { lead: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    blocksBetween(prisma, asker.organizationId, dayStart, dayEnd, tz),
  ]);

  const [oh, om] = hours.open.split(":").map(Number);
  const [ch, cm] = hours.close.split(":").map(Number);
  const open = zonedWallTimeToUtc(d.year, d.month, d.day, oh, om, tz);
  const close = zonedWallTimeToUtc(d.year, d.month, d.day, ch, cm, tz);

  return {
    date: label,
    open: `${hours.open} to ${hours.close}`,
    stylists: people.map((s) => {
      const working = s.workingDays.length === 0 || s.workingDays.includes(weekday);
      const mine = appointments.filter((a) => a.stylistName.toLowerCase() === s.name.toLowerCase());
      const busy = [
        ...mine.filter((a) => a.status !== "no_show").map((a) => ({ start: a.startsAt, end: a.endsAt })),
        ...blocks
          .filter((b) => b.stylistName === null || b.stylistName.toLowerCase() === s.name.toLowerCase())
          .map((b) => ({ start: b.start, end: b.end })),
      ].sort((x, y) => x.start.getTime() - y.start.getTime());
      const free: string[] = [];
      if (working) {
        let from = open;
        for (const b of [...busy, { start: close, end: close }]) {
          const until = b.start < close ? b.start : close;
          if (until.getTime() - from.getTime() >= 60 * 60_000) free.push(`${clock(from, tz)} to ${clock(until, tz)}`);
          if (b.end > from) from = b.end;
        }
      }
      return {
        name: s.name,
        working,
        appointments: mine.map((a) => ({
          time: `${clock(a.startsAt, tz)} to ${clock(a.endsAt, tz)}`,
          client: a.lead?.name ?? "Client",
          service: a.serviceText,
          status: a.status,
        })),
        blocked: blocks
          .filter((b) => b.stylistName === null || b.stylistName.toLowerCase() === s.name.toLowerCase())
          .map((b) => (b.allDay ? "all day" : `${clock(b.start, tz)} to ${clock(b.end, tz)}`)),
        freeForAnHourOrMore: free,
      };
    }),
  };
}

function resolveSpokenDateOrToday(spoken: string, tz: string): string | null {
  const t = spoken.trim().toLowerCase();
  if (t === "today" || t === "this afternoon" || t === "this morning") return zonedDateString(new Date(), tz);
  return resolveSpokenDate(spoken, tz);
}

// --- A client -----------------------------------------------------------------------------

/** Who they are, their notes, their visits: "when was Sarah last in, and what colour?" */
export async function clientHistory(asker: Asker, clientId: string) {
  const cfg = await getSalonConfig(asker.organizationId);
  const lead = await prisma.lead.findFirst({
    where: { id: clientId, organizationId: asker.organizationId },
    include: { contactLead: { select: { name: true, phone: true } } },
  });
  if (!lead) return { error: "That client was not found. Look them up again." };
  const visits = await prisma.appointment.findMany({
    where: {
      leadId: lead.id,
      status: { in: ["booked", "completed", "no_show", "cancelled"] },
    },
    orderBy: { startsAt: "desc" },
    take: 12,
  });
  const now = Date.now();
  const tz = cfg.timeZone;
  const line = (a: (typeof visits)[number]) => ({
    date: a.startsAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: tz }),
    time: clock(a.startsAt, tz),
    service: a.serviceText,
    stylist: a.stylistName,
    status: a.status,
    ...(a.notes ? { notes: a.notes } : {}),
    ...(a.amountMinor !== null ? { paid: pounds(a.amountMinor) } : {}),
  });
  return {
    name: lead.name,
    phone: lead.phone ?? (lead.contactLead ? `reached through ${lead.contactLead.name} on ${lead.contactLead.phone}` : null),
    notes: lead.notes ?? null,
    past: visits.filter((a) => a.startsAt.getTime() < now && a.status !== "cancelled").slice(0, 6).map(line),
    upcoming: visits.filter((a) => a.startsAt.getTime() >= now && a.status === "booked").reverse().map(line),
    cancelledRecently: visits.filter((a) => a.status === "cancelled").slice(0, 3).map(line),
  };
}

// --- The phone's messages ----------------------------------------------------------------

/**
 * What the phone took for the salon: callbacks still waiting, and recent
 * calls that did not end in a booking.
 */
export async function phoneMessages(asker: Asker, input: { days?: number }) {
  const cfg = await getSalonConfig(asker.organizationId);
  const tz = cfg.timeZone;
  const since = new Date(Date.now() - Math.min(Math.max(Number(input.days) || 7, 1), 31) * 86400_000);
  const callbacks = await prisma.callback.findMany({
    where: {
      organizationId: asker.organizationId,
      status: "pending",
    },
    include: { lead: { select: { name: true, phone: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const calls = await prisma.call.findMany({
    where: { organizationId: asker.organizationId, createdAt: { gte: since } },
    include: { lead: { select: { name: true, phone: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const bookedFrom = new Set(
    (
      await prisma.appointment.findMany({
        where: { callId: { in: calls.map((c) => c.id) } },
        select: { callId: true },
      })
    ).map((a) => a.callId)
  );
  const when = (at: Date) =>
    at.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  return {
    callbacksWaiting: callbacks.map((c) => ({
      who: c.lead?.name ?? "Unknown caller",
      phone: c.lead?.phone ?? null,
      called: when(c.createdAt),
      for: c.assignedTo,
      message: c.notes,
    })),
    callsNotBooked: calls
      .filter((c) => !bookedFrom.has(c.id))
      .map((c) => ({ when: when(c.createdAt), who: c.lead?.name ?? "Unknown caller", phone: c.phoneNumber, summary: c.summary })),
  };
}

// --- Takings -----------------------------------------------------------------------------

/** "How much did we take this week?" The same figures as the Sales report. */
export async function takings(asker: Asker, input: { period?: string; offset?: number; date?: string }) {
  const cfg: SalonConfig = await getSalonConfig(asker.organizationId);
  const kind = (["day", "week", "month", "year"].includes(String(input.period)) ? input.period : "week") as PeriodKind;
  let anchor = (input.date && resolveSpokenDateOrToday(input.date, cfg.timeZone)) || zonedDateString(new Date(), cfg.timeZone);
  const steps = Math.max(-24, Math.min(0, Math.round(Number(input.offset) || 0)));
  for (let i = 0; i < -steps; i++) anchor = shiftPeriod(kind, anchor, -1);
  const period = resolvePeriod(kind, anchor, cfg.timeZone);
  const { totals } = await computeTakings(asker.organizationId, period, cfg);
  return {
    period: describePeriod(period),
    taken: pounds(totals.takenMinor),
    appointmentsDone: totals.takenCount,
    doneWithNoAmountEntered: totals.unpricedCount,
    stillBooked: totals.bookedCount,
    stillBookedAtListPrice: pounds(totals.expectedMinor),
    noShows: totals.noShowCount,
    byStylist: totals.byStylist.map((s) => `${s.name} ${pounds(s.minor)} (${s.count})`),
    byService: totals.byService.slice(0, 8).map((s) => `${s.name} ${pounds(s.minor)} (${s.count})`),
  };
}
