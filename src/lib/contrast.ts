/**
 * Contrast helpers for client-chosen brand colours.
 *
 * The widget paints brandColor behind the launcher icon, the header and the
 * visitor's own message bubbles. Those were hardcoded to white text, so a
 * client picking a pale brand colour — yellow, mint, a light grey — shipped an
 * unreadable widget onto their own site and had no way to tell.
 *
 * Everything here is plain WCAG 2.1: sRGB linearisation, relative luminance,
 * and the (L+0.05) contrast ratio. No dependencies.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Accepts "#abc", "#aabbcc", or the same without the hash. */
export function parseHex(hex: string): Rgb | null {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two luminances, 1:1 to 21:1. */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Near-black rather than pure black: softer against saturated brand colours
// and still comfortably above AA on anything light enough to need it.
const DARK = "#111827";
const LIGHT = "#ffffff";

export interface ReadableText {
  /** Hex to use for text/icons sitting on the given background. */
  color: string;
  /** Contrast ratio achieved by that choice. */
  ratio: number;
  /** WCAG AA for normal text. */
  meetsAA: boolean;
  /** WCAG AAA for normal text. */
  meetsAAA: boolean;
  /** rgba overlay that reads as a subtle hover state against this background. */
  hoverOverlay: string;
}

/**
 * Pick whichever of near-black or white is more readable on `background`,
 * rather than assuming white. Falls back to white on an unparseable value so a
 * malformed colour can never render invisible text.
 */
export function readableTextOn(background: string): ReadableText {
  const rgb = parseHex(background);
  if (!rgb) {
    return {
      color: LIGHT,
      ratio: 1,
      meetsAA: false,
      meetsAAA: false,
      hoverOverlay: "rgba(255,255,255,0.12)",
    };
  }

  const bgLum = relativeLuminance(rgb);
  const onWhite = contrastRatio(bgLum, relativeLuminance(parseHex(LIGHT)!));
  const onDark = contrastRatio(bgLum, relativeLuminance(parseHex(DARK)!));

  const useDark = onDark > onWhite;
  const ratio = useDark ? onDark : onWhite;

  return {
    color: useDark ? DARK : LIGHT,
    ratio,
    meetsAA: ratio >= 4.5,
    meetsAAA: ratio >= 7,
    // The overlay has to match the text, not the background: a white veil is
    // invisible on a pale colour that's already carrying dark text.
    hoverOverlay: useDark ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.12)",
  };
}
