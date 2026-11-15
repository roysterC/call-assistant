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

/** A priced design from the quote answered in a chat, as the booking takes it. */
export interface QuotedDesign {
  quoteId: string;
  /** Its number in the reply: "1st design" is 1. */
  n: number;
  priceMinor: number;
  /** Null when the salon gave no time: the service's own length. */
  minutes: number | null;
}

/** The priced designs of a quote, numbered as its reply numbers them. */
export function quotedDesigns(quoteId: string, items: QuoteItem[]): QuotedDesign[] {
  return items.flatMap((item, i) =>
    item.declined || item.priceMinor === null ? [] : [{ quoteId, n: i + 1, priceMinor: item.priceMinor, minutes: item.minutes }]
  );
}

/**
 * Which quoted design a booking is for. `design` is what the receptionist
 * sent: the design's number, 0 for a booking that is none of them, or
 * nothing. Nothing, with one design quoted, is that design: "would you like
 * to book it?" "yes". With several, it has to ask which.
 */
export function pickQuotedDesign(
  designs: QuotedDesign[],
  design: unknown
): { ok: true; design: QuotedDesign | null } | { ok: false; message: string } {
  if (designs.length === 0) return { ok: true, design: null };
  const n = typeof design === "string" && design.trim() ? Number(design) : design;
  if (n === 0) return { ok: true, design: null };
  if (typeof n === "number" && Number.isInteger(n)) {
    const found = designs.find((d) => d.n === n);
    if (found) return { ok: true, design: found };
  } else if (designs.length === 1) {
    return { ok: true, design: designs[0] };
  }
  const list = designs.map((d) => `${ordinal(d.n)} design (${formatMoneyShort(d.priceMinor)})`).join(", ");
  return {
    ok: false,
    message:
      `The salon quoted ${list} in this chat. Ask which one they want, then send design with its number ` +
      "(1 for the 1st), or design 0 if this booking is none of them.",
  };
}
