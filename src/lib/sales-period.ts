/**
 * The four windows a salon looks at its takings through.
 *
 * Every window is resolved in the salon's own timezone, not UTC and not the
 * browser's. "September" means midnight on the 1st in London to midnight on
 * the 1st of October in London — which in BST is 23:00 on the 31st of August
 * as an instant. A month boundary an hour out puts the last evening of the
 * month in the wrong month, which is exactly the kind of error nobody spots
 * until the figures are compared against the bank.
 *
 * Weeks start on Monday. This is a UK salon and its rota is read that way.
 */

import { salonDayRange, wallTimeToUtc } from "@/lib/calendar-layout";

export type PeriodKind = "day" | "week" | "month" | "year";

export const PERIOD_KINDS: PeriodKind[] = ["day", "week", "month", "year"];

export interface Period {
  kind: PeriodKind;
  /** The day the window is anchored on, "YYYY-MM-DD". */
  anchor: string;
  /** Inclusive start instant, ISO. */
  from: string;
  /** Exclusive end instant, ISO. */
  to: string;
  /** First and last calendar day in the window, for labelling. */
  firstDate: string;
  lastDate: string;
}

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m: number, d: number): string {
  // Date.UTC normalises overflow, so month 13 and day 32 land correctly.
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string): string {
  const { y, m, d } = parts(date);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const backToMonday = (jsDay + 6) % 7;
  return iso(y, m, d - backToMonday);
}

/** The calendar day after `date`. */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date);
  return iso(y, m, d + days);
}

/** Resolve a window to the instants bounding it in the salon's zone. */
export function resolvePeriod(
  kind: PeriodKind,
  anchor: string,
  timeZone: string
): Period {
  const { y, m } = parts(anchor);

  let firstDate: string;
  let endExclusive: string;

  switch (kind) {
    case "day":
      firstDate = anchor;
      endExclusive = addDays(anchor, 1);
      break;
    case "week":
      firstDate = startOfWeek(anchor);
      endExclusive = addDays(firstDate, 7);
      break;
    case "month":
      firstDate = iso(y, m, 1);
      endExclusive = iso(y, m + 1, 1);
      break;
    case "year":
      firstDate = iso(y, 1, 1);
      endExclusive = iso(y + 1, 1, 1);
      break;
  }

  return {
    kind,
    anchor,
    from: salonDayRange(firstDate, timeZone).from,
    to: wallTimeToUtc(endExclusive, "00:00", timeZone).toISOString(),
    firstDate,
    lastDate: addDays(endExclusive, -1),
  };
}

/** Step a window forwards or backwards by one of itself. */
export function shiftPeriod(
  kind: PeriodKind,
  anchor: string,
  direction: 1 | -1
): string {
  const { y, m, d } = parts(anchor);
  switch (kind) {
    case "day":
      return addDays(anchor, direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "month": {
      // Clamp the day, so stepping back from the 31st of March lands on the
      // 28th of February rather than overflowing into March again.
      const target = new Date(Date.UTC(y, m - 1 + direction, 1));
      const ty = target.getUTCFullYear();
      const tm = target.getUTCMonth() + 1;
      const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      return iso(ty, tm, Math.min(d, lastDay));
    }
    case "year": {
      const lastDay = new Date(Date.UTC(y + direction, m, 0)).getUTCDate();
      return iso(y + direction, m, Math.min(d, lastDay));
    }
  }
}

/** How the window reads in a heading. */
export function describePeriod(period: Period): string {
  const asDate = (s: string) => {
    const { y, m, d } = parts(s);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const fmt = (s: string, opts: Intl.DateTimeFormatOptions) =>
    asDate(s).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

  switch (period.kind) {
    case "day":
      return fmt(period.firstDate, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    case "week":
      return `${fmt(period.firstDate, { day: "numeric", month: "short" })} – ${fmt(
        period.lastDate,
        { day: "numeric", month: "short", year: "numeric" }
      )}`;
    case "month":
      return fmt(period.firstDate, { month: "long", year: "numeric" });
    case "year":
      return fmt(period.firstDate, { year: "numeric" });
  }
}
