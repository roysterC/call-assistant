/**
 * The words a general-purpose recogniser gets wrong on a salon's calls: its
 * own name, its stylists, the unusual words in its services, and the trade's
 * own vocabulary and brands. "Balayage" heard as "bally arj", or
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

// Deepgram advises the 20 to 50 terms that matter most: a longer list can
// make it hear terms that were not said.
export const MAX_KEYTERMS = 50;

/**
 * Hairdressing words callers use that ordinary speech recognition mangles:
 * techniques, treatments, brands, and the skin test the booking rules turn
 * on. Everyday words ("cut", "trim", "colour") are left out on purpose: they
 * are heard fine already, and boosting short common words makes the
 * recogniser hear them where they were not said.
 */
export const HAIRDRESSING_TERMS = [
  // Brands and techniques first: the words most often misheard, so the last
  // to be dropped if a salon's own list is long.
  "Kérastase",
  "L'Oréal",
  "Wella",
  "Redken",
  "Olaplex",
  "K18",
  "balayage",
  "babylights",
  "ombré",
  "lowlights",
  "T-section",
  "keratin treatment",
  "Brazilian blow dry",
  "patch test",
  "skin test",
  "toner",
  "root tint",
  "regrowth",
  "half head",
  "full head",
  "foils",
  "colour correction",
  "bleach",
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
];
/**
 * Ordinary words in service names, which Deepgram hears fine already. A
 * service is listened for by its other words only: "Yuko straightening" by
 * "Yuko", "Olaplex treatment" by "Olaplex". Whole names made of these
 * ("Wash and blow dry, medium hair", "Children's cut age 0 to 6") took up
 * slots that brands and trade words then lost, and Deepgram advises boosting
 * only the words it gets wrong.
 */
const EVERYDAY = new Set(
  (
    "a an and or the of with to for up on in at by from plus per only extra " +
    "ladies lady men mens men's gents gent children childrens children's child kids kid boys boy girls girl " +
    "age ages years year yrs under over " +
    "cut cuts trim trims dry wash blow blowdry blow-dry finish style styling styled restyle " +
    "short medium long hair full half head top roots root colour colours color colors tint tints " +
    "highlights highlight lights treatment treatments party bridal wedding fringe beard shave " +
    "straightening straighten curls curly wave waves set new client clients consultation appointment " +
    "small large standard deluxe express mini quick simple basic"
  ).split(" ")
);

/** The words of a service name worth listening for: see EVERYDAY. */
export function serviceWords(name: string): string[] {
  return tidy(name)
    .split(" ")
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !EVERYDAY.has(w.toLowerCase()));
}

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
  for (const s of input.services ?? []) candidates.push(...serviceWords(s.name));
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
