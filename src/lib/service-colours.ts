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
 * dark chart surface: all four sit inside the L 0.48-0.67 band, clear the
 * chroma floor, hold a CVD separation of ΔE 19.1 at worst (deutan) and 25.5
 * for normal vision, and pass contrast. They are not eyeballed.
 *
 * Emitted as inline styles rather than Tailwind classes on purpose: the
 * service list comes from settings at runtime, and as the note in
 * `status-styles.ts` says, Tailwind only scans source for literal class names
 * — `bg-${hue}-500/15` compiles to nothing at all.
 */

import { splitServiceText } from "@/lib/salon-config";

export type ServiceFamily = "cutting" | "colour" | "finishing" | "treatment" | "other";

export interface ServiceTone {
  family: ServiceFamily;
  /** Block fill. Low alpha so the text above it stays legible. */
  fill: string;
  /** Block edge, where most of the colour identity actually reads. */
  border: string;
}

export const FAMILY_LABEL: Record<ServiceFamily, string> = {
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
export const FAMILY_STEPS: Record<ServiceFamily, string[]> = {
  cutting: ["#3f88d4", "#6aa5e2", "#2b6cae", "#8fbcea"],
  colour: ["#c47726", "#db9445", "#a3611a", "#e8ad6b"],
  finishing: ["#8a6fd4", "#a78fe2", "#6d53b0", "#c0aeea"],
  treatment: ["#2f9455", "#4cb071", "#227340", "#77c795"],
  other: ["#7a8a86", "#95a3a0", "#61706c", "#b0bbb8"],
};

/** The hue a family is known by, for the legend. */
export const FAMILY_HUE: Record<ServiceFamily, string> = {
  cutting: FAMILY_STEPS.cutting[0],
  colour: FAMILY_STEPS.colour[0],
  finishing: FAMILY_STEPS.finishing[0],
  treatment: FAMILY_STEPS.treatment[0],
  other: FAMILY_STEPS.other[0],
};

const KEYWORDS: Array<{ family: ServiceFamily; words: string[] }> = [
  { family: "cutting", words: ["cut", "trim", "restyle", "fringe", "barber", "clipper", "shave"] },
  { family: "finishing", words: ["blow", "dry", "style", "curl", "updo", "occasion", "bridal", "set"] },
  { family: "treatment", words: ["treatment", "olaplex", "mask", "condition", "keratin", "perm", "scalp"] },
  { family: "colour", words: ["colour", "color", "tint", "highlight", "balayage", "toner", "bleach", "ombre"] },
];

/**
 * Which family a service belongs to.
 *
 * `requiresPatchTest` is checked first because it is data rather than a guess:
 * a service needing a skin test 48 hours ahead is colour work, whatever the
 * salon has chosen to call it. Names are only consulted after that, and a
 * service matching nothing falls to a neutral grey rather than borrowing a
 * family's meaning.
 */
export function classifyService(
  name: string,
  requiresPatchTest?: boolean
): ServiceFamily {
  if (requiresPatchTest) return "colour";

  const text = String(name ?? "").toLowerCase();
  for (const { family, words } of KEYWORDS) {
    if (words.some((w) => text.includes(w))) return family;
  }
  return "other";
}

export interface ServiceLike {
  name: string;
  requiresPatchTest?: boolean;
}

/**
 * Build the service -> colour map for one salon.
 *
 * Keyed on the lower-cased name, because an appointment stores the service as
 * text rather than a foreign key. Step order follows the configured service
 * list, so the mapping is stable across reloads and a salon can nudge two
 * similar services apart by reordering them in settings.
 */
export function buildServiceTones(
  services: ServiceLike[]
): Map<string, ServiceTone> {
  const seen: Partial<Record<ServiceFamily, number>> = {};
  const out = new Map<string, ServiceTone>();

  for (const s of services) {
    const name = String(s?.name ?? "").trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (out.has(key)) continue;

    const family = classifyService(name, s.requiresPatchTest);
    const index = seen[family] ?? 0;
    seen[family] = index + 1;

    const steps = FAMILY_STEPS[family];
    const hex = steps[index % steps.length];

    out.set(key, {
      family,
      // Alpha suffixes: ~18% fill keeps 11px text readable over it, and a
      // strong edge is what actually carries the colour at block size.
      fill: `${hex}2e`,
      border: `${hex}b3`,
    });
  }

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

  // A service that has since been renamed or deleted in settings still has
  // appointments in the diary. Grey is honest: it says "not one of the
  // current services" rather than colouring it as something it is not.
  const hex = FAMILY_STEPS.other[0];
  return { family: "other", fill: `${hex}2e`, border: `${hex}b3` };
}

/** Families actually in use, in a stable order, for the legend. */
export function familiesInUse(services: ServiceLike[]): ServiceFamily[] {
  const order: ServiceFamily[] = ["cutting", "colour", "finishing", "treatment", "other"];
  const present = new Set(
    services
      .filter((s) => String(s?.name ?? "").trim())
      .map((s) => classifyService(s.name, s.requiresPatchTest))
  );
  return order.filter((f) => present.has(f));
}
