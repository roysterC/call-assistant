/**
 * A callback filed because the diary refused a booking the receptionist was
 * making (src/lib/receptionist/booking.ts) carries what was wanted in its
 * note:
 *
 *   COULD NOT BOOK: <why>
 *   Wanted: <service> with <stylist> at <ISO time>
 *   <their own notes, if any>
 *
 * The Callbacks page shows it as "Couldn't book" with what they wanted,
 * rather than as a raw note.
 */

export interface CouldNotBook {
  reason: string;
  service: string | null;
  stylist: string | null;
  /** ISO, as written. */
  startsAt: string | null;
  /** Anything else in the note: their own words. */
  rest: string | null;
}

const HEAD = /^COULD NOT BOOK:\s*(.*)$/;
const WANTED = /^Wanted:\s*(.+?) with (.+?) at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*$/;

export function readCouldNotBook(notes: string | null | undefined): CouldNotBook | null {
  if (!notes) return null;
  const lines = notes.split("\n");
  const head = lines[0]?.match(HEAD);
  if (!head) return null;
  const wanted = lines[1]?.match(WANTED);
  const rest = lines.slice(wanted ? 2 : 1).join("\n").trim() || null;
  return {
    reason: head[1].trim(),
    service: wanted?.[1] ?? null,
    stylist: wanted?.[2] ?? null,
    startsAt: wanted?.[3] ?? null,
    rest,
  };
}
