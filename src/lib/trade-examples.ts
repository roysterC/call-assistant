/**
 * Example lines in each trade's own services.
 *
 * Kikai's instructions (the phone, the chats, the assistant) are written once,
 * with hair examples: "a blow dry with Chloe". Left as they were, a nail
 * salon's receptionist was shown blow dries and colour, and a model copies
 * its examples. So, as the instructions are put together, each hair example
 * is swapped for the salon's main trade's own. A hair salon's are untouched
 * (business-types.test.ts holds them to it), and a test fails if a hair
 * example is left in another trade's.
 */

import type { BusinessType } from "@/lib/business-types";

/** The hair wording, exactly as the instructions have it, and each other trade's. */
type Swap = { hair: string; nails: string; beauty: string; barber: string };

const SWAPS: Swap[] = [
  // The read-back (receptionist/instructions.ts).
  {
    hair: "a blow dry with Chloe",
    nails: "a BIAB infill with Lan",
    beauty: "a lash lift with Chloe",
    barber: "a skin fade with Marcus",
  },
  // Two services in one appointment.
  {
    hair: "Someone who wants a cut and a beard trim",
    nails: "Someone who wants a gel manicure and a gel pedicure",
    beauty: "Someone who wants an eyebrow shape and a tint",
    barber: "Someone who wants a cut and a beard trim",
  },
  {
    hair: '"haircut and beard trim"',
    nails: '"gel manicure and gel pedicure"',
    beauty: '"eyebrow shape and eyebrow tint"',
    barber: '"haircut and beard trim"',
  },
  // The chat's worked exchange (receptionist/prompt.ts).
  {
    hair: `*"Can I book a cut?"* You: *"Is that a ladies' cut or a men's cut?"*`,
    nails: `*"Can I book a BIAB?"* You: *"Is that a full set or an infill?"*`,
    beauty: `*"Can I book a wax?"* You: *"Which area is it for?"*`,
    barber: `*"Can I get a fade?"* You: *"Skin, low or high?"*`,
  },
  {
    hair: `*"Ladies'."*`,
    nails: `*"Infill."*`,
    beauty: `*"Half leg."*`,
    barber: `*"Skin."*`,
  },
  {
    hair: `*"Great. Which cut would you like: ladies', men's or a child's, and a blow dry too? And what day suits you?"*`,
    nails: `*"Great. Which BIAB would you like: natural nails or extensions, and a full set or an infill? And what day suits you?"*`,
    beauty: `*"Great. Which area would you like waxed, and have you been to us before? And what day suits you?"*`,
    barber: `*"Great. Which fade would you like: skin, low or high, and a beard trim too? And what day suits you?"*`,
  },
  // The assistant (voice-booking/assistant.ts).
  {
    hair: "Sarah's colour at eleven",
    nails: "Sarah's BIAB infill at eleven",
    beauty: "Sarah's facial at eleven",
    barber: "Dan's skin fade at eleven",
  },
  {
    hair: "walk-in for a cut?",
    nails: "walk-in for a gel manicure?",
    beauty: "walk-in for an eyebrow shape?",
    barber: "walk-in for a fade?",
  },
  {
    hair: "next gap for a\n  balayage",
    nails: "next gap for an\n  acrylic full set",
    beauty: "next gap for a\n  lash lift",
    barber: "next gap for a\n  haircut and beard",
  },
  {
    hair: "what colour did we use?",
    nails: "what colour did she have?",
    beauty: "which facial did she have?",
    barber: "what grade did we use?",
  },
  // Only where the trade has skin tests.
  {
    hair: ', "Jo had her patch test today"',
    nails: "",
    beauty: ', "Jo had her patch test today"',
    barber: "",
  },
];

/** `text` with its hair examples in `trade`'s own. */
export function inTradeExamples(text: string, trade: BusinessType): string {
  if (trade === "hair") return text;
  return SWAPS.reduce((t, s) => t.split(s.hair).join(s[trade]), text);
}

/** Hair examples still in `text` that `trade` has its own for: none, once swapped. */
export function hairExamplesLeft(text: string, trade: BusinessType): string[] {
  if (trade === "hair") return [];
  return SWAPS.filter((s) => s[trade] !== s.hair && text.includes(s.hair)).map((s) => s.hair);
}
