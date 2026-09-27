/**
 * "Yes" and "no" to a booking on screen, decided by plain code.
 *
 * Saving is the one step that must never rest on a model's reading of a
 * sentence. A short, plain yes saves; a short, plain no drops the card.
 * Anything with more in it, "yes but with Marcus", "no, Friday", is a
 * correction, and goes back to the assistant to redraw the card.
 */

const YES = new Set([
  "yes", "yeah", "yep", "yup", "yes please", "ok", "okay", "sure", "correct", "right", "perfect",
  "lovely", "great", "fine", "brilliant", "save", "book", "confirm", "go", "do", "good",
]);
const NO = new Set(["no", "nope", "nah", "cancel", "scrap", "forget", "stop", "don't", "dont", "never"]);

/** Words that may follow a yes or a no without changing it. */
const FILLER = new Set([
  "yes", "yeah", "please", "thanks", "thank", "you", "cheers", "that", "that's", "thats", "it", "is",
  "it's", "its", "the", "one", "fine", "great", "lovely", "perfect", "right", "correct", "good",
  "save", "saved", "book", "booked", "in", "go", "ahead", "for", "do", "confirm", "ok", "okay",
  "sure", "brilliant", "mind", "booking", "all", "looks", "sounds", "this",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}' ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Lead-ins before the answer itself: "that's fine", "sounds good". */
const LEAD_IN = new Set(["that's", "thats", "that", "it's", "its", "sounds", "looks", "all"]);

export function answerTo(text: string): "yes" | "no" | null {
  const all = words(text);
  let start = 0;
  while (start < all.length - 1 && LEAD_IN.has(all[start])) start++;
  const w = all.slice(start);
  if (w.length === 0 || all.length > 6) return null;
  const rest = w.slice(1).every((x) => FILLER.has(x));
  if (!rest) return null;
  if (YES.has(w[0])) return "yes";
  if (NO.has(w[0])) return "no";
  return null;
}
