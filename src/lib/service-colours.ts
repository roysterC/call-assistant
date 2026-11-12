/**
 * A colour per service, so a glance at the diary says what kind of day it is.
 *
 * Twelve unrelated hues would defeat the point — nobody memorises twelve, and
 * at the size of a fifteen-minute block they stop being recognisable and start
 * being decoration. So colour is assigned by *family* first: every cut sits in
 * one hue, every colour job in another. Services within a family differ by
 * step, which keeps them individually distinguishable while a busy Saturday
 * still reads as "mostly colour" from across the room.
 *
 * The four family hues were checked with the dataviz validator against the
 * old dark chart surface: all four sit inside the L 0.48-0.67 band, clear the
 * chroma floor, and hold a CVD separation of ΔE 19.1 at worst (deutan) and
 * 25.5 for normal vision. They are not eyeballed. On the light theme the
 * block text is the dark foreground over an 18% tint, and the hue is carried
 * by a 3px leading edge at 70%, so the separation still does the work.
 *
 * The tint is solid: the hue mixed with white, not laid over the grid at 18%
 * alpha. See-through, the quarter-hour lines ran across every booking.
 *
 * The families are each trade's own (GROUPS): a nail salon's diary reads as
 * manicures, pedicures, sets and art, not as hair's cutting and colour, which
 * left nearly every nail booking grey. Each trade's families take the same
 * four validated hues (slots), and a salon of several trades is coloured by
 * trade instead: hair in one hue, nails in another. A salon can also choose a
 * service's family itself in Settings (SalonService.group), over the guess.
 *
 * Emitted as inline styles rather than Tailwind classes on purpose: the
 * service list comes from settings at runtime, and as the note in
 * `status-styles.ts` says, Tailwind only scans source for literal class names
 * — `bg-${hue}-500/15` compiles to nothing at all.
 */

import { splitServiceText } from "@/lib/salon-config";
import type { BusinessType } from "@/lib/business-types";

/** Hair's families, which the four validated hues are named after. */
export type HairFamily = "cutting" | "colour" | "finishing" | "treatment" | "other";

/**
 * A family's id: one of a trade's groups ("cutting", "manicure"), a whole
 * trade for a salon of several ("nails"), or "other". Its label is the
 * i18n message `family.<id>`.
 */
export type ServiceFamily = string;

export interface ServiceTone {
  family: ServiceFamily;
  /** Block fill: a light, solid tint so the text above it stays legible. */
  fill: string;
  /** Block edge, where most of the colour identity actually reads. */
  border: string;
}

export const FAMILY_LABEL: Record<HairFamily, string> = {
  cutting: "Cutting",
  colour: "Colour",
  finishing: "Finishing",
  treatment: "Treatments",
  other: "Other",
};

/**
 * Base hue per family, then steps within it.
 *
 * Steps are written out rather than generated. A hue computed at runtime is
 * exactly how a palette drifts out of the band it was validated in.
 */
export const FAMILY_STEPS: Record<HairFamily, string[]> = {
  cutting: ["#3f88d4", "#6aa5e2", "#2b6cae", "#8fbcea"],
  colour: ["#c47726", "#db9445", "#a3611a", "#e8ad6b"],
  finishing: ["#8a6fd4", "#a78fe2", "#6d53b0", "#c0aeea"],
  treatment: ["#2f9455", "#4cb071", "#227340", "#77c795"],
  other: ["#7a8a86", "#95a3a0", "#61706c", "#b0bbb8"],
};

/**
 * `hex` at `share` over white, as a solid colour. The card the diary sits on
 * is white, so this is what the old 18% alpha fill looked like, minus the
 * gridlines showing through it.
 */
export function solidTint(hex: string, share = 0.18): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const mix = (c: number) => Math.round(255 + (c - 255) * share);
  const rgb = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The hue a family is known by, for the legend. */
export const FAMILY_HUE: Record<HairFamily, string> = {
  cutting: FAMILY_STEPS.cutting[0],
  colour: FAMILY_STEPS.colour[0],
  finishing: FAMILY_STEPS.finishing[0],
  treatment: FAMILY_STEPS.treatment[0],
  other: FAMILY_STEPS.other[0],
};

/**
 * A booking the receptionist took that this person has not opened yet, in
 * the diary and on its pop-up. Magenta, because no service family and
 * nothing in the app's own palette uses it, so "new" never reads as a kind
 * of service. The chip's white text on the deep step clears 4.5:1.
 */
export const NEW_BOOKING = {
  fill: solidTint("#d63384"),
  border: "#d63384",
  chip: "#b02a6b",
} as const;

/** One of the four validated hues, by position; "other" is grey. */
type Slot = 0 | 1 | 2 | 3;
const SLOT_HUES: HairFamily[] = ["cutting", "colour", "finishing", "treatment"];

interface Group {
  id: ServiceFamily;
  slot: Slot;
  /** Whole words (or their plurals) in a service's name that put it here. */
  words: string[];
  /** Where a service needing a skin test goes, whatever it is called. */
  skinTests?: boolean;
}

/**
 * Each trade's families, in the order a name is tried: the first with one of
 * its words in the name wins, so the more particular come first ("Gel
 * removal" is a removal before it is gel; "Beard trim" is the beard's).
 *
 * Hair's are the four this file began with, so a hair salon's diary is
 * coloured exactly as it was.
 */
export const GROUPS: Record<BusinessType, Group[]> = {
  hair: [
    { id: "cutting", slot: 0, words: ["cut", "haircut", "trim", "restyle", "fringe", "barber", "clipper", "shave"] },
    {
      id: "finishing",
      slot: 2,
      words: ["blow", "blowdry", "dry", "style", "styling", "curl", "curly", "updo", "occasion", "bridal", "set", "hair up"],
    },
    {
      id: "treatment",
      slot: 3,
      words: ["treatment", "olaplex", "mask", "condition", "conditioning", "keratin", "perm", "scalp", "straighten", "straightening", "yuko", "smoothing"],
    },
    {
      id: "colour",
      slot: 1,
      skinTests: true,
      words: ["colour", "colouring", "color", "coloring", "tint", "tinting", "highlight", "balayage", "toner", "tone", "bleach", "ombre", "ombré", "root", "regrowth", "foil", "gloss"],
    },
  ],
  nails: [
    {
      id: "nailart",
      slot: 3,
      words: ["art", "design", "chrome", "french", "ombre", "ombré", "gem", "removal", "remove", "soak off", "soak-off", "repair", "fix"],
    },
    { id: "pedicure", slot: 1, words: ["pedicure", "pedi", "toe", "feet", "foot"] },
    {
      id: "enhancement",
      slot: 2,
      words: ["set", "infill", "fill", "refill", "acrylic", "extension", "builder", "biab", "overlay", "sculpted", "tip", "polygel", "gel x", "gel-x", "hard gel"],
    },
    { id: "manicure", slot: 0, words: ["manicure", "mani", "hand", "polish", "shellac", "cuticle", "gel", "nail"] },
  ],
  beauty: [
    { id: "brows", slot: 0, skinTests: true, words: ["brow", "eyebrow", "lash", "eyelash", "lamination", "henna", "lash lift"] },
    { id: "waxing", slot: 1, words: ["wax", "waxing", "threading", "sugaring", "hair removal", "laser", "electrolysis", "brazilian", "hollywood"] },
    {
      id: "skin",
      slot: 2,
      words: ["facial", "skin", "peel", "microdermabrasion", "dermaplaning", "hydrafacial", "microneedling", "led", "acne"],
    },
    { id: "body", slot: 3, words: ["massage", "tan", "tanning", "spray tan", "body", "scrub", "wrap", "reflexology", "hot stone"] },
  ],
  barber: [
    { id: "fades", slot: 1, words: ["fade", "skin fade", "taper", "buzz", "clipper", "zero"] },
    { id: "cuts", slot: 0, words: ["cut", "haircut", "crop", "scissor", "restyle", "flat top", "short back"] },
    {
      id: "beard",
      slot: 2,
      words: ["beard", "shave", "moustache", "mustache", "hot towel", "line up", "lineup", "shape up", "shape-up", "edge up"],
    },
    { id: "extras", slot: 3, words: ["colour", "color", "grey blending", "camo", "bleach", "highlight", "facial", "mask", "wax", "treatment"] },
  ],
};

/** What a salon's diary is coloured by: its trade's own families, or, for a salon of several, by trade. */
export interface FamilyScheme {
  types: BusinessType[];
  byTrade: boolean;
  /** In slot order, which is the legend's. */
  families: Array<{ id: ServiceFamily; slot: Slot }>;
}

export function familyScheme(types?: readonly BusinessType[] | null): FamilyScheme {
  const list: BusinessType[] = types?.length ? [...new Set(types)] : ["hair"];
  if (list.length === 1) {
    const families = GROUPS[list[0]].map((g) => ({ id: g.id, slot: g.slot })).sort((a, b) => a.slot - b.slot);
    return { types: list, byTrade: false, families };
  }
  return { types: list, byTrade: true, families: list.slice(0, 4).map((t, i) => ({ id: t, slot: i as Slot })) };
}

/** The families a service can be put in by hand, in Settings: the salon's own, then Other. */
export function familyChoices(types?: readonly BusinessType[] | null): ServiceFamily[] {
  return [...familyScheme(types).families.map((f) => f.id), "other"];
}

const patterns = new Map<string, RegExp>();

/**
 * Whether `word` is in `text` as a word of its own, or its plural: "cut" is
 * in "Ladies cut" and "Two cuts", never in "Cuticle care"; "style" never in
 * "Freestyle art". Matching letters anywhere was how nail art became hair
 * finishing.
 */
function hasWord(text: string, word: string): boolean {
  let re = patterns.get(word);
  if (!re) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^\\p{L}])${escaped}(s|es)?($|[^\\p{L}])`, "u");
    patterns.set(word, re);
  }
  return re.test(text);
}

/** The first group with a word in `text`, and the longest of its words found. */
function firstGroup(text: string, groups: Group[]): { id: ServiceFamily; length: number } | null {
  for (const g of groups) {
    const found = g.words.filter((w) => hasWord(text, w));
    if (found.length) return { id: g.id, length: Math.max(...found.map((w) => w.length)) };
  }
  return null;
}

/** The longest of a trade's words in `text`: how surely a name is that trade's. */
function longestWord(text: string, groups: Group[]): number {
  let best = 0;
  for (const g of groups) for (const w of g.words) if (w.length > best && hasWord(text, w)) best = w.length;
  return best;
}

function classifyIn(scheme: FamilyScheme, name: string, requiresPatchTest?: boolean, group?: string): ServiceFamily {
  // The salon's own choice, where it is one of its families.
  if (group && (group === "other" || scheme.families.some((f) => f.id === group))) return group;

  const text = String(name ?? "").toLowerCase();
  if (!scheme.byTrade) {
    const groups = GROUPS[scheme.types[0]];
    // A skin test 48 hours ahead is data rather than a guess: colour work
    // at a hair salon, a tint at a beauty salon, whatever it is called.
    const skin = requiresPatchTest ? groups.find((g) => g.skinTests) : undefined;
    if (skin) return skin.id;
    return firstGroup(text, groups)?.id ?? "other";
  }

  // Several trades: the one whose words fit the name best, the longest word
  // matched ("Acrylic full set" is nails' "acrylic", not hair's "set"), the
  // main trade on a tie.
  let best: { trade: BusinessType; length: number } | null = null;
  for (const t of scheme.families.map((f) => f.id as BusinessType)) {
    const length = longestWord(text, GROUPS[t]);
    if (length > (best?.length ?? 0)) best = { trade: t, length };
  }
  if (best) return best.trade;
  if (requiresPatchTest) {
    const skin = scheme.families.find((f) => GROUPS[f.id as BusinessType].some((g) => g.skinTests));
    if (skin) return skin.id;
  }
  return "other";
}

/**
 * Which family a service belongs to: the salon's own choice (`group`) where
 * it made one, else worked out from the skin test and the name, among the
 * families of the salon's trades (hair if not given).
 *
 * `requiresPatchTest` is checked before the name because it is data rather
 * than a guess. A service matching nothing falls to a neutral grey rather
 * than borrowing a family's meaning.
 */
export function classifyService(
  name: string,
  requiresPatchTest?: boolean,
  types?: readonly BusinessType[] | null,
  group?: string
): ServiceFamily {
  return classifyIn(familyScheme(types), name, requiresPatchTest, group);
}

/** A family's hue steps: its slot's, or grey for Other. */
function stepsFor(scheme: FamilyScheme, family: ServiceFamily): string[] {
  const f = scheme.families.find((x) => x.id === family);
  return f ? FAMILY_STEPS[SLOT_HUES[f.slot]] : FAMILY_STEPS.other;
}

/** The hue a family is known by, for the legend and Settings. */
export function familyHue(family: ServiceFamily, types?: readonly BusinessType[] | null): string {
  return stepsFor(familyScheme(types), family)[0];
}

export interface ServiceLike {
  name: string;
  requiresPatchTest?: boolean;
  /** The family the salon chose for it, if any. */
  group?: string;
}

/** Which salon's families a tone map was built with, for toneFor's guesses. */
const SCHEMES = new WeakMap<Map<string, ServiceTone>, FamilyScheme>();

/**
 * Build the service -> colour map for one salon.
 *
 * Keyed on the lower-cased name, because an appointment stores the service as
 * text rather than a foreign key. Step order follows the configured service
 * list, so the mapping is stable across reloads and a salon can nudge two
 * similar services apart by reordering them in settings.
 */
export function buildServiceTones(
  services: ServiceLike[],
  types?: readonly BusinessType[] | null
): Map<string, ServiceTone> {
  const scheme = familyScheme(types);
  const seen: Partial<Record<ServiceFamily, number>> = {};
  const out = new Map<string, ServiceTone>();

  for (const s of services) {
    const name = String(s?.name ?? "").trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (out.has(key)) continue;

    const family = classifyIn(scheme, name, s.requiresPatchTest, s.group);
    const index = seen[family] ?? 0;
    seen[family] = index + 1;

    const steps = stepsFor(scheme, family);
    const hex = steps[index % steps.length];

    out.set(key, {
      family,
      // A light fill keeps 11px text readable over it, and a strong edge is
      // what actually carries the colour at block size.
      fill: solidTint(hex),
      border: `${hex}b3`,
    });
  }

  SCHEMES.set(out, scheme);
  return out;
}

/** Tone for one appointment's service text, falling back to neutral. */
export function toneFor(
  serviceText: string,
  tones: Map<string, ServiceTone>
): ServiceTone {
  const text = String(serviceText ?? "").trim();
  const hit = tones.get(text.toLowerCase());
  if (hit) return hit;

  // An appointment covering several services is coloured by the longest of
  // them, which is the one `combineServices` puts first. The block should read
  // as the work that fills most of it rather than as "not a current service".
  const parts = splitServiceText(text);
  if (parts.length > 1) {
    const lead = tones.get(parts[0].toLowerCase());
    if (lead) return lead;
  }

  // A service since renamed or deleted in settings still has appointments in
  // the diary. These used to be grey, so a new price list turned the whole
  // diary grey at once: every booking made before it carried an old name.
  // Coloured by what the name says instead ("Root tint" is colour, "Cut and
  // finish" is cutting), the way a current service is; grey only when the
  // name says nothing.
  const scheme = SCHEMES.get(tones) ?? familyScheme();
  const family = classifyIn(scheme, parts[0] ?? text);
  const hex = stepsFor(scheme, family)[0];
  return { family, fill: solidTint(hex), border: `${hex}b3` };
}

/** Families actually in use, in the legend's order (Other last). */
export function familiesInUse(services: ServiceLike[], types?: readonly BusinessType[] | null): ServiceFamily[] {
  const scheme = familyScheme(types);
  const present = new Set(
    services
      .filter((s) => String(s?.name ?? "").trim())
      .map((s) => classifyIn(scheme, s.name, s.requiresPatchTest, s.group))
  );
  return [...scheme.families.map((f) => f.id), "other"].filter((f) => present.has(f));
}
