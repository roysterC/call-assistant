/**
 * A colour per stylist, worn as a round badge with their initials at the top
 * of their column and on the phone's stylist tabs.
 *
 * Assigned by team order (the order in Settings), not by a hash of the name:
 * a hash gives two of a three-person team the same colour as often as not,
 * and the team order is already the order the columns stand in.
 *
 * Deep, earthy tones that sit with the sage scheme and stay clear of the
 * service hues the bookings below them wear, so a badge never reads as a kind
 * of service. White initials on each clear 4.5:1.
 */

export const STYLIST_COLOURS = [
  "#5b6635", // sage
  "#a0522d", // sienna
  "#2f6f73", // teal
  "#7b4b94", // plum
  "#3b5b92", // denim
  "#a33b4a", // brick
  "#7a6420", // ochre
  "#4f5d6e", // slate
] as const;

/** Someone no longer on the team: no colour of their own. */
export const FORMER_STYLIST_COLOUR = "#6b7066";

export function stylistColour(index: number): string {
  return STYLIST_COLOURS[((index % STYLIST_COLOURS.length) + STYLIST_COLOURS.length) % STYLIST_COLOURS.length];
}

/** "Chris" → "C", "Anna Lee" → "AL", "Nguyễn Thị Lan" → "NL". */
export function stylistInitials(name: string): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = (w: string) => Array.from(w)[0]?.toLocaleUpperCase() ?? "";
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
}
