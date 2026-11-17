/**
 * The trade Kikai serves: nail salons (Nov 2026; hair, beauty and barbers
 * were supported before and were dropped when Kikai narrowed to nails).
 *
 * The profile says what the receptionist, the chat bots and the diary's
 * assistant know about the trade, never how the diary works:
 *
 * - what the team are called (nail technician);
 * - the examples in the rules for questions (what to ask when a request could
 *   be several services, what "not on the list" looks like);
 * - why a price is a "from" price, and which health questions go to the team;
 * - the trade's words the phone listens for (keyterms.ts);
 * - extra phone rules (walk-ins);
 * - the starter price list a new salon is given.
 *
 * Kept as a list of one, with the column it is stored in, so the machinery
 * that reads it stays as it is; every salon is nails whatever is stored.
 */

import type { SalonService } from "@/lib/salon-config";

export const BUSINESS_TYPES = ["nails"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface BusinessProfile {
  id: BusinessType;
  /** As the admin shows it. */
  label: string;
  /** In a sentence: "a nail salon". */
  kind: string;
  /** What one of the team is called, to customers. */
  staff: string;
  /** "General X questions, such as …": answerable from general knowledge. */
  generalQuestions: string;
  /** A service that sounds listed but is not, for the "not on the list" rule. */
  notListedExample: string;
  /** What a listed service must not be said to include. */
  notIncludedExample: string;
  /** Requests that could be several listed services: ask which. */
  ambiguous: string;
  /** Why a listed price is only a starting price. */
  priceReason: string;
  /** Health matters the bots never advise on. */
  healthTopics: string[];
  /** Services whose booking needs the skin test mentioned. */
  skinTestFor: string[];
  /** The trade's words a recogniser mishears, most important first. */
  keyterms: readonly string[];
  /** Ordinary words in this trade's service names, heard fine already. */
  everyday: readonly string[];
  /** Phone rules for this trade only, as bullet lines. */
  phoneRules: readonly string[];
  /** A new salon's price list: names and lengths, prices left for the salon. */
  starterServices: readonly Omit<SalonService, "priceMinor">[];
}

/** Walk-ins: answered when asked about, never suggested (Roy, Nov 2026). */
const WALK_INS =
  "- **Walk-ins:** only if they ask whether they can come in now, check today's diary and offer the " +
  "soonest free time today. Never suggest coming in without a booking otherwise.";

const NAILS: BusinessProfile = {
  id: "nails",
  label: "Nail salon",
  kind: "nail salon",
  staff: "nail technician",
  generalQuestions:
    "nail questions, such as the difference between gel, acrylic and BIAB or how long a set usually lasts",
  notListedExample: "a salon that lists gel nails has not said it does BIAB",
  notIncludedExample: "a removal or nail art",
  ambiguous: "nails: gel, acrylic or BIAB; a new set or an infill; hands, feet or both",
  priceReason: "nail art and designs are priced individually",
  healthTopics: ["allergies", "skin reactions", "pregnancy", "nail infections", "damaged nails"],
  skinTestFor: [],
  keyterms: [
    "BIAB",
    "Shellac",
    "OPI",
    "CND",
    "The Gel Bottle",
    "Gel-X",
    "SNS",
    "dip powder",
    "builder gel",
    "polygel",
    "acrylics",
    "infill",
    "soak off",
    "French tip",
    "chrome",
    "cat eye",
    "ombré",
    "nail art",
    "coffin",
    "almond",
    "stiletto",
    "Japanese manicure",
    "paraffin",
  ],
  everyday:
    "nail nails manicure mani pedicure pedi hands hand feet foot toes toe toenail toenails gel polish removal remove soak off art design designs set sets fill fills infill infills shape file french tip tips take redo change extension extensions tier without normal".split(
      " "
    ),
  phoneRules: [WALK_INS],
  // The demo salon's own menu (Nov 2026), one service per treatment and
  // finish. Unpriced: the salon fills in its prices.
  starterServices: [
    { name: "Acrylic full set, gel colour", durationMinutes: 75, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "Acrylic infill, gel colour" },
    { name: "Acrylic full set, French tip", durationMinutes: 85, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "Acrylic infill, French tip" },
    { name: "Acrylic infill, gel colour", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "Acrylic infill, French tip", durationMinutes: 70, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "Acrylic take off & redo, gel colour", durationMinutes: 90, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "Acrylic infill, gel colour" },
    { name: "Acrylic take off & redo, French tip", durationMinutes: 100, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "Acrylic infill, French tip" },
    { name: "Acrylic take off only", durationMinutes: 30, requiresPatchTest: false },
    { name: "BIAB full set, colour", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "BIAB infill, colour" },
    { name: "BIAB full set, French tip", durationMinutes: 70, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "BIAB infill, French tip" },
    { name: "BIAB infill, colour", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "BIAB infill, French tip", durationMinutes: 70, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "Manicure with gel", durationMinutes: 55, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "Manicure with colour", durationMinutes: 50, requiresPatchTest: false, rebookWeeks: 2 },
    { name: "Manicure, no colour", durationMinutes: 45, requiresPatchTest: false },
    { name: "Pedicure, gel colour", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 4 },
    { name: "Pedicure, French tip", durationMinutes: 65, requiresPatchTest: false, rebookWeeks: 4 },
    { name: "Pedicure, normal colour", durationMinutes: 55, requiresPatchTest: false, rebookWeeks: 4 },
    { name: "Pedicure, no colour", durationMinutes: 50, requiresPatchTest: false },
    { name: "Toenail colour change", durationMinutes: 20, requiresPatchTest: false },
    { name: "Toenail extension", durationMinutes: 10, requiresPatchTest: false },
    { name: "Toenail designs", durationMinutes: 15, requiresPatchTest: false },
    { name: "Gel removal", durationMinutes: 15, requiresPatchTest: false },
    { name: "Nail art tier 1", durationMinutes: 10, requiresPatchTest: false },
    { name: "Nail art tier 2", durationMinutes: 20, requiresPatchTest: false },
    { name: "Nail art tier 3", durationMinutes: 40, requiresPatchTest: false },
  ],
};

export const PROFILES: Record<BusinessType, BusinessProfile> = {
  nails: NAILS,
};

export function isBusinessType(v: unknown): v is BusinessType {
  return typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v);
}

/** The main type then the others, valid and once each; nails whatever is stored (Kikai is for nail salons). */
export function businessTypesOf(main: unknown, also: unknown = []): BusinessType[] {
  const out: BusinessType[] = [isBusinessType(main) ? main : "nails"];
  for (const t of Array.isArray(also) ? also : []) if (isBusinessType(t) && !out.includes(t)) out.push(t);
  return out;
}

/** A salon's trade, all its types together: what the prompts and the recogniser are given. */
export interface Trade {
  types: BusinessType[];
  /** The main type's word for the team. */
  staff: string;
  generalQuestions: string;
  notListedExample: string;
  notIncludedExample: string;
  ambiguous: string;
  priceReason: string;
  healthTopics: string;
  skinTestFor: string[];
  keyterms: string[];
  everyday: string[];
  phoneRules: string[];
}

/**
 * The profiles of a salon's types as one: the main type's words for the team
 * and its examples first, then each other type's added on.
 */
export function tradeFor(types: readonly BusinessType[] | undefined): Trade {
  const list = (types?.length ? types.filter(isBusinessType) : []).map((t) => PROFILES[t]);
  if (list.length === 0) list.push(NAILS);
  const main = list[0];
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  return {
    types: list.map((p) => p.id),
    staff: main.staff,
    generalQuestions: list.map((p) => p.generalQuestions).join("; or "),
    notListedExample: main.notListedExample,
    notIncludedExample: main.notIncludedExample,
    ambiguous: list.map((p) => p.ambiguous).join("; "),
    priceReason: list.map((p) => p.priceReason).join(", and "),
    healthTopics: orList(uniq(list.flatMap((p) => p.healthTopics))),
    skinTestFor: uniq(list.flatMap((p) => p.skinTestFor)),
    // Taken in turn from each type's list, so a second type's words are not
    // all dropped behind the first's when the recogniser's list fills up.
    keyterms: interleave(list.map((p) => [...p.keyterms])),
    everyday: uniq(list.flatMap((p) => [...p.everyday])),
    phoneRules: uniq(list.flatMap((p) => [...p.phoneRules])),
  };
}

/** "a, b or c". */
export function orList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/**
 * The prompts' own word "stylist" in this trade's word, keeping its capital
 * and plural. Only for text Kikai wrote: a salon's own words are left as
 * they wrote them.
 */
export function inTradeWords(text: string, trade: Pick<Trade, "staff">): string {
  if (trade.staff === "stylist") return text;
  return text.replace(/\b([Ss])tylist(s?)\b/g, (_m, s: string, plural: string) => {
    const word = s === "S" ? trade.staff[0].toUpperCase() + trade.staff.slice(1) : trade.staff;
    return word + plural;
  });
}

/** A new salon's price list, from all its types, unpriced. */
export function starterServices(types: readonly BusinessType[]): SalonService[] {
  const seen = new Set<string>();
  const out: SalonService[] = [];
  for (const t of types) {
    for (const s of PROFILES[t].starterServices) {
      if (seen.has(s.name.toLowerCase())) continue;
      seen.add(s.name.toLowerCase());
      out.push({ ...s, priceMinor: null });
    }
  }
  return out;
}
