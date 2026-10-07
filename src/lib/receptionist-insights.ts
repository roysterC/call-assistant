/**
 * What the phone receptionist did over a window: how many calls it took, when
 * they came, what they came to, and what it booked. The question an owner asks
 * of it is "is it earning its keep?", so the figures are the ones that answer
 * that: bookings and their value, and the calls that arrived while the salon
 * was closed and would otherwise have gone to voicemail.
 *
 * Pure: the route fetches the rows, this counts them. Days and hours are the
 * salon's own, in its time zone.
 */

import { isOpenAt, zonedDateString, zonedParts, type BusinessHours } from "@/lib/business-hours";

export interface InsightCall {
  createdAt: Date;
  duration: number;
  outcomes: string[];
}

export interface InsightBooking {
  createdAt: Date;
  serviceText: string;
}

export interface ReceptionistInsights {
  range: { days: number; from: string; to: string; timeZone: string };
  totals: {
    calls: number;
    avgDurationSeconds: number;
    /** Null when the salon's hours are not set, so "closed" cannot be known. */
    whileClosed: number | null;
    whileClosedRate: number | null;
    bookings: number;
    /** Calls that ended in a booking, as a share of all calls. */
    bookingRate: number;
    bookedValueMinor: number;
    /** Bookings whose service has no list price, left out of the value. */
    unpricedBookings: number;
    callbacks: number;
  };
  daily: { day: string; calls: number; bookings: number }[];
  hourly: { hour: number; calls: number }[];
  outcomes: { outcome: string; count: number }[];
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/** Every salon date from `from` to `to`, inclusive, as YYYY-MM-DD. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function summariseReceptionist(input: {
  calls: InsightCall[];
  bookings: InsightBooking[];
  callbacks: number;
  priceOf: (serviceText: string) => number | null;
  hours: BusinessHours;
  timeZone: string;
  days: number;
  now: Date;
}): ReceptionistInsights {
  const { calls, bookings, hours, timeZone, now } = input;
  const start = new Date(now.getTime() - (input.days - 1) * 24 * 60 * 60 * 1000);
  const from = zonedDateString(start, timeZone);
  const to = zonedDateString(now, timeZone);

  const daily = new Map(datesBetween(from, to).map((day) => [day, { day, calls: 0, bookings: 0 }]));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0 }));
  const outcomes = new Map<string, number>();
  const hoursKnown = hours.length > 0;
  let whileClosed = 0;
  let booked = 0;
  let totalDuration = 0;

  for (const c of calls) {
    const day = daily.get(zonedDateString(c.createdAt, timeZone));
    if (day) day.calls++;
    hourly[zonedParts(c.createdAt, timeZone).hour].calls++;
    if (hoursKnown && !isOpenAt(hours, timeZone, c.createdAt)) whileClosed++;
    if (c.outcomes.includes("booked")) booked++;
    totalDuration += c.duration;
    for (const o of new Set(c.outcomes)) outcomes.set(o, (outcomes.get(o) ?? 0) + 1);
  }

  let bookedValueMinor = 0;
  let unpricedBookings = 0;
  for (const b of bookings) {
    const day = daily.get(zonedDateString(b.createdAt, timeZone));
    if (day) day.bookings++;
    const price = input.priceOf(b.serviceText);
    if (price === null) unpricedBookings++;
    else bookedValueMinor += price;
  }

  return {
    range: { days: input.days, from, to, timeZone },
    totals: {
      calls: calls.length,
      avgDurationSeconds: calls.length ? Math.round(totalDuration / calls.length) : 0,
      whileClosed: hoursKnown ? whileClosed : null,
      whileClosedRate: hoursKnown ? pct(whileClosed, calls.length) : null,
      bookings: bookings.length,
      bookingRate: pct(booked, calls.length),
      bookedValueMinor,
      unpricedBookings,
      callbacks: input.callbacks,
    },
    daily: [...daily.values()],
    hourly,
    outcomes: [...outcomes.entries()]
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome)),
  };
}
