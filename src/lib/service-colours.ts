/**
 * A colour per service, so a glance at the diary says what kind of day it is.
 *
 * Twelve unrelated hues would defeat the point — nobody memorises twelve, and
 * at the size of a fifteen-minute block they stop being recognisable and start
 * being decoration. So colour is assigned by *family* first: every manicure
 * sits in one hue, every set and infill in another. Services within a family
 * differ by step, which keeps them individually distinguishable while a busy
 * Saturday still reads as "mostly infills" from across the room.
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
 * The families are a nail salon's (GROUPS): manicures, pedicures, sets and
 * infills, and nail art and removals, each in one of the four validated hues.
 * A salon can also choose a service's family itself in Settings
 * (SalonService.group), over the guess.
 *
 * Emitted as inline styles rather than Tailwind classes on purpose: the
 * service list comes from settings at runtime, and as the note in
 * `status-styles.ts` says, Tailwind only scans source for literal class names
 * — `bg-${hue}-500/15` compiles to nothing at all.
 */

import { splitServiceText } from "@/lib/salon-config";
import type { BusinessType } from "@/lib/business-types";

/** The four validated hues, by what they are, and grey for Other. */
type Hue = "blue" | "orange" | "purple" | "green" | "grey";

/** A family's id: one of the groups ("manicure"), or "other". Its label is the i18n message `family.<id>`. */
export type ServiceFamily = string;

export interface ServiceTone {
  family: ServiceFamily;
  /** Block fill: a light, solid tint so the text above it stays legible. */
  fill: string;
  /** Block edge, where most of the colour identity actually reads. */
  border: string;
}

/**
 * Base hue per family, then steps within it.
 *
 * Steps are written out rather than generated. A hue computed at runtime is
 * exactly how a palette drifts out of the band it was validated in.
 */
export const FAMILY_STEPS: Record<Hue, string[]> = {
  blue: ["#3f88d4", "#6aa5e2", "#2b6cae", "#8fbcea"],
  orange: ["#c47726", "#db9445", "#a3611a", "#e8ad6b"],
  purple: ["#8a6fd4", "#a78fe2", "#6d53b0", "#c0aeea"],
  green: ["#2f9455", "#4cb071", "#227340", "#77c795"],
  grey: ["#7a8a86", "#95a3a0", "#61706c", "#b0bbb8"],
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
const SLOT_HUES: Hue[] = ["blue", "orange", "purple", "green"];

interface Group {
  id: ServiceFamily;
  slot: Slot;
  /** Whole words (or their plurals) in a service's name that put it here. */
  words: string[];
}

/**
 * The families, in the order a name is tried: the first with one of its words
 * in the name wins, so the more particular come first ("Gel removal" is a
 * removal before it is gel).
 */
export const GROUPS: Record<BusinessType, Group[]> = {
  nails: [
    {
      id: "nailart",
      slot: 3,
      words: ["art", "design", "chrome", "ombre", "ombré", "gem", "removal", "remove", "soak off", "soak-off", "repair", "fix"],
    },
    { id: "pedicure", slot: 1, words: ["pedicure", "pedi", "toe", "toenail", "feet", "foot"] },
    {
      id: "enhancement",
      slot: 2,
      words: ["set", "infill", "fill", "refill", "acrylic", "extension", "builder", "biab", "overlay", "sculpted", "tip", "polygel", "gel x", "gel-x", "hard gel"],
    },
    { id: "manicure", slot: 0, words: ["manicure", "mani", "hand", "polish", "shellac", "cuticle", "gel", "nail"] },
  ],
};

/** What a salon's diary is coloured by: its trade's families. */
export interface FamilyScheme {
  types: BusinessType[];
  /** In slot order, which is the legend's. */
  families: Array<{ id: ServiceFamily; slot: Slot }>;
}

export function familyScheme(types?: readonly BusinessType[] | null): FamilyScheme {
  const trade: BusinessType = types?.find((t) => t in GROUPS) ?? "nails";
  const families = GROUPS[trade].map((g) => ({ id: g.id, slot: g.slot })).sort((a, b) => a.slot - b.slot);
  return { types: [trade], families };
}

/** The families a service can be put in by hand, in Settings: the salon's own, then Other. */
export function familyChoices(types?: readonly BusinessType[] | null): ServiceFamily[] {
  return [...familyScheme(types).families.map((f) => f.id), "other"];
}

const patterns = new Map<string, RegExp>();

/**
 * Whether `word` is in `text` as a word of its own, or its plural: "set" is
 * in "Full set" and "Two sets", never in "Settle"; "gel" never in "Angel
 * art". Matching letters anywhere put services in the wrong family.
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

function classifyIn(scheme: FamilyScheme, name: string, group?: string): ServiceFamily {
  // The salon's own choice, where it is one of its families.
  if (group && (group === "other" || scheme.families.some((f) => f.id === group))) return group;
  return firstGroup(String(name ?? "").toLowerCase(), GROUPS[scheme.types[0]])?.id ?? "other";
}

/**
 * Which family a service belongs to: the salon's own choice (`group`) where
 * it made one, else worked out from its name. A service matching nothing
 * falls to a neutral grey rather than borrowing a family's meaning.
 */
export function classifyService(
  name: string,
  // Was the skin test, which put colour work in its family; kept so callers need not change.
  _requiresPatchTest?: boolean,
  types?: readonly BusinessType[] | null,
  group?: string
): ServiceFamily {
  return classifyIn(familyScheme(types), name, group);
}

/** A family's hue steps: its slot's, or grey for Other. */
function stepsFor(scheme: FamilyScheme, family: ServiceFamily): string[] {
  const f = scheme.families.find((x) => x.id === family);
  return f ? FAMILY_STEPS[SLOT_HUES[f.slot]] : FAMILY_STEPS.grey;
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

    const family = classifyIn(scheme, name, s.group);
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
  // Coloured by what the name says instead ("Gel pedicure" is a pedicure),
  // the way a current service is; grey only when the name says nothing.
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
      .map((s) => classifyIn(scheme, s.name, s.group))
  );
  return [...scheme.families.map((f) => f.id), "other"].filter((f) => present.has(f));
}
