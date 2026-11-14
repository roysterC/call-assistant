/**
 * A quote's designs and the reply it sends, worked out the same way in the
 * inbox's preview and on the server, so what the technician sees before
 * sending is word for word what the client gets. Plain code, no database.
 */

import { formatMoneyShort } from "@/lib/money";

/** One design in a quote: the photo, and the salon's answer to it. */
export interface QuoteItem {
  photoId: string;
  /** Pence. Null until priced, and for a design the salon does not do. */
  priceMinor: number | null;
  /** How long it takes, when the salon said; otherwise the service's own length. */
  minutes: number | null;
  /** Not something the salon does. */
  declined: boolean;
}

/** The stored items, read defensively: anything malformed is left out. */
export function parseQuoteItems(raw: unknown): QuoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (!r || typeof r !== "object" || typeof (r as QuoteItem).photoId !== "string") return [];
    const x = r as Partial<QuoteItem>;
    return [
      {
        photoId: x.photoId!,
        priceMinor: typeof x.priceMinor === "number" && x.priceMinor >= 0 ? Math.round(x.priceMinor) : null,
        minutes: typeof x.minutes === "number" && x.minutes > 0 ? Math.round(x.minutes) : null,
        declined: x.declined === true,
      },
    ];
  });
}

/** Every design answered (priced, or not done) and at least one priced: ready to send. */
export function quoteReady(items: QuoteItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((i) => i.declined || i.priceMinor !== null) &&
    items.some((i) => !i.declined && i.priceMinor !== null)
  );
}

/** "1st", "2nd", "3rd", "4th"… */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** 90 → "1h 30", 120 → "2h", 45 → "45 min". */
export function minutesText(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${String(rest).padStart(2, "0")}` : `${h}h`;
}

function priceLine(item: QuoteItem): string {
  if (item.declined) return "not one we do, sorry";
  return `${formatMoneyShort(item.priceMinor)}${item.minutes ? `, about ${minutesText(item.minutes)}` : ""}`;
}

/**
 * The reply to the client: the numbers exactly as entered, never rounded
 * or reworded, in the chat's own tone. `from` is who priced it (a first
 * name), or null for "the team".
 */
export function quoteReply(items: QuoteItem[], from: string | null): string {
  const who = from?.trim() || "the team";
  const offered = items.filter((i) => !i.declined && i.priceMinor !== null);
  if (items.length === 1) {
    const only = items[0];
    return only.declined
      ? `Thanks for waiting! I'm sorry, ${who} says that design isn't one we do. Is there another you'd like a price for?`
      : `Thanks for waiting! ${capitalise(who)} says that design would be ${priceLine(only)}. Would you like to book it?`;
  }
  const lines = items.map((item, i) => `${ordinal(i + 1)} design: ${priceLine(item)}`);
  const ask = offered.length === 1 ? "Would you like to book it?" : "Would you like to book one? Just say which.";
  return [`Thanks for waiting! Here are the prices from ${who}:`, ...lines, ask].join("\n");
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
