/**
 * What kind of business a salon is: hair, nails, beauty or barbers.
 *
 * Chosen by Kikai when the salon is set up (Admin → Organizations), as a main
 * type and any others it also offers: plenty of UK salons are "hair and
 * beauty", and nail shops often do lashes and waxing. The type changes what
 * the receptionist, the chat bots and the diary's assistant know about the
 * trade, never how the diary works:
 *
 * - what the team are called (stylist, nail technician, therapist, barber);
 * - the examples in the rules for questions (what to ask when a request could
 *   be several services, what "not on the list" looks like);
 * - why a price is a "from" price, and which health questions go to the team;
 * - which services need a skin test mentioned;
 * - the trade's words the phone listens for (keyterms.ts);
 * - extra phone rules (walk-ins, for the trades where they are common);
 * - the starter price list a new salon is given.
 *
 * Hair is the default, and a hair-only salon's instructions are exactly what
 * they were before types existed (business-types.test.ts holds them to it).
 */

import type { SalonService } from "@/lib/salon-config";
import { HAIRDRESSING_TERMS } from "@/lib/receptionist/voice/keyterms";

export const BUSINESS_TYPES = ["hair", "nails", "beauty", "barber"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface BusinessProfile {
  id: BusinessType;
  /** As the admin shows it. */
  label: string;
  /** In a sentence: "a nail salon", "a barber's". */
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
  /**
   * A new salon's price list: names and lengths, prices left for the salon.
   * No skin tests switched on: the skin-test booking rules are written for
   * hair colour (parked, Nov 2026), so a beauty salon turns them on itself.
   */
  starterServices: readonly Omit<SalonService, "priceMinor">[];
}

/** Walk-ins: answered when asked about, never suggested (Roy, Nov 2026). */
const WALK_INS =
  "- **Walk-ins:** only if they ask whether they can come in now, check today's diary and offer the " +
  "soonest free time today. Never suggest coming in without a booking otherwise.";

const HAIR: BusinessProfile = {
  id: "hair",
  label: "Hair salon",
  kind: "hair salon",
  staff: "stylist",
  generalQuestions: "hair questions, such as what a toner or Olaplex does or how often to have a trim",
  notListedExample: "a salon that lists highlights has not said it does balayage",
  notIncludedExample: "a fringe trim or a toner",
  ambiguous:
    "a haircut: ladies, men's or a child's; a blow dry for short, medium or long hair; highlights on the top, half or full head",
  priceReason: "it depends on length and thickness",
  healthTopics: ["allergies", "skin reactions", "pregnancy", "hair loss", "scalp conditions"],
  skinTestFor: ["colour"],
  keyterms: HAIRDRESSING_TERMS,
  everyday: [],
  phoneRules: [],
  starterServices: [
    { name: "Ladies cut and blow dry", durationMinutes: 60, requiresPatchTest: false },
    { name: "Men's cut", durationMinutes: 30, requiresPatchTest: false },
    { name: "Children's cut", durationMinutes: 30, requiresPatchTest: false },
    { name: "Wash and blow dry", durationMinutes: 45, requiresPatchTest: false },
    { name: "Fringe trim", durationMinutes: 15, requiresPatchTest: false },
  ],
};

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
    "nail nails manicure mani pedicure pedi hands hand feet foot toes toe gel polish removal remove soak off art design designs set sets fill fills shape file".split(
      " "
    ),
  phoneRules: [WALK_INS],
  starterServices: [
    { name: "Gel manicure", durationMinutes: 45, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "Gel pedicure", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 4 },
    { name: "BIAB new set", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "BIAB infill" },
    { name: "BIAB infill", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "Acrylic full set", durationMinutes: 75, requiresPatchTest: false, rebookWeeks: 3, rebookAs: "Acrylic infill" },
    { name: "Acrylic infill", durationMinutes: 60, requiresPatchTest: false, rebookWeeks: 3 },
    { name: "Gel removal", durationMinutes: 20, requiresPatchTest: false },
  ],
};

const BEAUTY: BusinessProfile = {
  id: "beauty",
  label: "Beauty salon",
  kind: "beauty salon",
  staff: "therapist",
  generalQuestions:
    "beauty questions, such as what a lash lift or dermaplaning involves or how long a wax usually lasts",
  notListedExample: "a salon that lists a lash lift has not said it does lash extensions",
  notIncludedExample: "a tint or a brow shape",
  ambiguous: "waxing: which area; lashes: a lift, extensions or an infill; a facial: which one",
  priceReason: "it depends on the treatment",
  healthTopics: ["allergies", "skin reactions", "pregnancy", "medication", "skin conditions"],
  skinTestFor: ["lash and brow tints", "lash extensions"],
  keyterms: [
    "HD brows",
    "Henna brows",
    "brow lamination",
    "lash lift",
    "lash extensions",
    "Russian volume",
    "hybrid lashes",
    "threading",
    "dermaplaning",
    "microdermabrasion",
    "Hydrafacial",
    "chemical peel",
    "microneedling",
    "microblading",
    "Hollywood wax",
    "Brazilian wax",
    "spray tan",
    "St Tropez",
    "Elemis",
    "Dermalogica",
    "Guinot",
    "patch test",
    "skin test",
  ],
  everyday:
    "wax waxing brow brows eyebrow eyebrows lash lashes eyelash eyelashes facial facials massage tint lift leg legs arm arms underarm underarms lip chin face back body tan".split(
      " "
    ),
  phoneRules: [WALK_INS],
  starterServices: [
    { name: "Eyebrow shape", durationMinutes: 15, requiresPatchTest: false },
    { name: "Eyebrow tint", durationMinutes: 15, requiresPatchTest: false },
    { name: "Lash lift and tint", durationMinutes: 60, requiresPatchTest: false },
    { name: "Half leg wax", durationMinutes: 30, requiresPatchTest: false },
    { name: "Express facial", durationMinutes: 30, requiresPatchTest: false },
  ],
};

const BARBER: BusinessProfile = {
  id: "barber",
  label: "Barbers",
  kind: "barber's",
  staff: "barber",
  generalQuestions: "barbering questions, such as what a skin fade or a taper is or how often to have a trim",
  notListedExample: "a shop that lists fades has not said it does hot towel shaves",
  notIncludedExample: "a beard trim or a hot towel",
  ambiguous: "a haircut: men's or a child's; a fade: skin, low or high; a beard: a trim or a shape-up",
  priceReason: "it depends on the cut",
  healthTopics: ["allergies", "skin reactions", "hair loss", "scalp conditions"],
  skinTestFor: [],
  keyterms: [
    "skin fade",
    "taper",
    "burst fade",
    "drop fade",
    "French crop",
    "textured crop",
    "buzz cut",
    "line up",
    "shape up",
    "hot towel",
    "cut-throat",
    "beard sculpt",
    "hair design",
    "clipper cut",
    "scissor cut",
    "undercut",
    "mullet",
    "quiff",
  ],
  everyday: "fade fades taper beard shave shape line clipper clippers scissor scissors grade number skin hot towel".split(
    " "
  ),
  phoneRules: [WALK_INS],
  starterServices: [
    { name: "Men's haircut", durationMinutes: 30, requiresPatchTest: false },
    { name: "Skin fade", durationMinutes: 30, requiresPatchTest: false },
    { name: "Beard trim", durationMinutes: 15, requiresPatchTest: false },
    { name: "Haircut and beard", durationMinutes: 45, requiresPatchTest: false },
    { name: "Children's haircut", durationMinutes: 30, requiresPatchTest: false },
  ],
};

export const PROFILES: Record<BusinessType, BusinessProfile> = {
  hair: HAIR,
  nails: NAILS,
  beauty: BEAUTY,
  barber: BARBER,
};

export function isBusinessType(v: unknown): v is BusinessType {
  return typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v);
}

/** The main type then the others, valid and once each; hair when nothing is set. */
export function businessTypesOf(main: unknown, also: unknown = []): BusinessType[] {
  const out: BusinessType[] = [isBusinessType(main) ? main : "hair"];
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
  const list = (types?.length ? types : (["hair"] as const)).map((t) => PROFILES[t]);
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
