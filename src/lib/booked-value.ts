/**
 * What Kikai has booked a salon: the Insights page's one big number.
 *
 * Counts the bookings the receptionist made itself, on a call or in a chat
 * (source "voice"; a chat booking says which chat in its notes), at the price
 * taken, or the price list's until it is. Cancelled ones are left out by the
 * caller. Plain code, no database: used by /api/insights/booked and its tests.
 */

import { bookedByMessage } from "@/lib/booked-by";
import { isOpenAt, type BusinessHours } from "@/lib/business-hours";

export const BOOKED_CHANNELS = ["phone", "whatsapp", "instagram", "facebook", "website"] as const;
export type BookedChannel = (typeof BOOKED_CHANNELS)[number];

export interface BookedRow {
  createdAt: Date;
  serviceText: string;
  amountMinor: number | null;
  notes: string | null;
}

export interface BookedValue {
  totalMinor: number;
  bookings: number;
  /** Bookings with neither a price taken nor a list price, left out of the total. */
  unpriced: number;
  /** What was booked while the salon was shut; null when its hours are not set. */
  afterHoursMinor: number | null;
  /** By where the booking was made, in BOOKED_CHANNELS order, only those with any. */
  channels: { channel: BookedChannel; valueMinor: number; bookings: number }[];
  /** The service booked most, and its list price: "that's 40 gel manicures". */
  favourite: { service: string; priceMinor: number } | null;
}

const BY_NAME: Record<string, BookedChannel> = {
  WhatsApp: "whatsapp",
  Instagram: "instagram",
  Messenger: "facebook",
  "website chat": "website",
};

export function channelOf(notes: string | null): BookedChannel {
  const name = bookedByMessage(notes);
  return name ? BY_NAME[name] : "phone";
}

export function summariseBooked(input: {
  rows: BookedRow[];
  priceOf: (serviceText: string) => number | null;
  hours: BusinessHours;
  timeZone: string;
}): BookedValue {
  const { rows, priceOf, hours, timeZone } = input;
  const hoursKnown = hours.length > 0;
  let totalMinor = 0;
  let unpriced = 0;
  let afterHours = 0;
  const byChannel = new Map<BookedChannel, { valueMinor: number; bookings: number }>();
  const byService = new Map<string, { service: string; count: number }>();

  for (const r of rows) {
    const value = r.amountMinor ?? priceOf(r.serviceText);
    const channel = channelOf(r.notes);
    const c = byChannel.get(channel) ?? { valueMinor: 0, bookings: 0 };
    c.bookings++;
    if (value === null) {
      unpriced++;
    } else {
      totalMinor += value;
      c.valueMinor += value;
      if (hoursKnown && !isOpenAt(hours, timeZone, r.createdAt)) afterHours += value;
    }
    byChannel.set(channel, c);
    const key = r.serviceText.trim().toLowerCase();
    if (key) {
      const s = byService.get(key) ?? { service: r.serviceText.trim(), count: 0 };
      s.count++;
      byService.set(key, s);
    }
  }

  // The most booked service that has a list price to divide by.
  let favourite: BookedValue["favourite"] = null;
  for (const s of [...byService.values()].sort((a, b) => b.count - a.count)) {
    const price = priceOf(s.service);
    if (price && price > 0) {
      favourite = { service: s.service, priceMinor: price };
      break;
    }
  }

  return {
    totalMinor,
    bookings: rows.length,
    unpriced,
    afterHoursMinor: hoursKnown ? afterHours : null,
    channels: BOOKED_CHANNELS.filter((ch) => byChannel.has(ch)).map((channel) => ({ channel, ...byChannel.get(channel)! })),
    favourite,
  };
}
