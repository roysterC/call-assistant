/**
 * Money, in minor units.
 *
 * Every amount in this codebase is an integer number of pence. Floats are not
 * an option for a till: 0.1 + 0.2 is famously not 0.3, and a month-end report
 * that disagrees with the bank by a penny is a report nobody trusts again.
 *
 * The currency is GBP throughout — the salon is in London and the prompt
 * already tells the agent to speak in pounds. When a second currency is
 * genuinely needed it becomes a column, not a guess made at the formatter.
 */

export const CURRENCY = "GBP";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 2,
});

/** "£45.00" for 4500. */
export function formatMoney(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return "—";
  }
  return GBP.format(minor / 100);
}

/** "£45" for 4500, "£45.50" for 4550 — for tiles, where pence are noise. */
export function formatMoneyShort(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) {
    return "—";
  }
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * Pence from whatever someone typed.
 *
 * Accepts "45", "45.5", "45.50", "£45.50", "1,250" and the empty string.
 * Returns null rather than 0 for anything it cannot read, because a price
 * that failed to parse and a price of nothing are different facts and only
 * one of them should be saved.
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }

  const cleaned = input.trim().replace(/[£,\s]/g, "");
  if (!cleaned) return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "." || cleaned === "-") {
    return null;
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  // Rounded rather than truncated: someone typing 45.555 means 45.56, and
  // dropping the fraction silently loses money over a month of entries.
  return Math.round(value * 100);
}

/** Pence as a plain editable string — "45.00" for 4500. No symbol. */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  return (minor / 100).toFixed(2);
}

/** Sum that tolerates the nulls a half-finished day is full of. */
export function sumMinor(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}
