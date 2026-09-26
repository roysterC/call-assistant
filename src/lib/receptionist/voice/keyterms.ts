/**
 * The words a general-purpose recogniser gets wrong on a salon's calls: its
 * own name, its stylists, its services, and the trade's own vocabulary. "Balayage" heard as "bally arj", or
 * "Siobhan" as "shove on", sends a booking to the wrong place, so Deepgram is
 * told to listen for them (Nova-3's keyterm prompting).
 *
 * Taken from the salon's settings when the call starts, so a stylist added in
 * Settings is listened for from the next call. Kept short: Deepgram caps the
 * list, and a long one dilutes the boost for the words that matter. The
 * salon's name comes first, then its people, then its services, then the
 * trade's words, so a salon with a big team and menu loses the general
 * vocabulary before anything of its own.
 */

import type { SalonService, Stylist } from "@/lib/salon-config";

export const MAX_KEYTERMS = 60;

/**
 * Hairdressing words callers use that ordinary speech recognition mangles:
 * techniques, treatments, brands, and the skin test the booking rules turn
 * on. Everyday words ("cut", "trim", "colour") are left out on purpose: they
 * are heard fine already, and boosting short common words makes the
 * recogniser hear them where they were not said.
 */
export const HAIRDRESSING_TERMS = [
  "patch test",
  "skin test",
  "balayage",
  "babylights",
  "ombré",
  "lowlights",
  "toner",
  "root tint",
  "regrowth",
  "half head",
  "full head",
  "T-section",
  "foils",
  "colour correction",
  "bleach",
  "Olaplex",
  "K18",
  "keratin treatment",
  "Brazilian blow dry",
  "blow dry",
  "cut and finish",
  "restyle",
  "fringe trim",
  "curtain fringe",
  "skin fade",
  "pixie cut",
  "extensions",
  "updo",
  "bridal trial",
  "Kérastase",
  "L'Oréal",
  "Wella",
  "Redken",
];
/** Deepgram counts the list in tokens; this keeps well inside its limit. */
const MAX_TOTAL_CHARS = 1000;
const MAX_TERM_CHARS = 50;

export function salonKeyterms(input: {
  businessName?: string | null;
  stylists?: Pick<Stylist, "name">[];
  services?: Pick<SalonService, "name">[];
}): string[] {
  const candidates: string[] = [];
  if (input.businessName) candidates.push(input.businessName);
  for (const s of input.stylists ?? []) {
    candidates.push(s.name);
    // Callers ask for "Siobhan", not "Siobhan O'Neill".
    const first = tidy(s.name).split(" ")[0];
    if (first) candidates.push(first);
  }
  for (const s of input.services ?? []) candidates.push(s.name);
  candidates.push(...HAIRDRESSING_TERMS);

  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const raw of candidates) {
    const term = tidy(raw);
    if (term.length < 2 || term.length > MAX_TERM_CHARS) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (out.length >= MAX_KEYTERMS || chars + term.length > MAX_TOTAL_CHARS) break;
    seen.add(key);
    out.push(term);
    chars += term.length;
  }
  return out;
}

/** Letters, digits and the punctuation names carry; one space between words. */
function tidy(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}'&\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
