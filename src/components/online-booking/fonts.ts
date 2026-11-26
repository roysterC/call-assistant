/**
 * The salon pages' two faces, shipped with the app like its other fonts
 * (app/layout.tsx), from the @fontsource-variable packages (OFL).
 *
 * Bricolage Grotesque, narrowed and heavy, for headings; Instrument Sans for
 * everything read. Instrument Sans has no Vietnamese, so its stack falls
 * through to the app's Inter for those letters (a staff member's name, say).
 */

import localFont from "next/font/local";

// "standard" files carry the width and optical-size axes as well as weight.
const display = localFont({
  src: "../../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2",
  variable: "--font-salon-display",
  adjustFontFallback: false,
});
const displayExt = localFont({
  src: "../../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-standard-normal.woff2",
  variable: "--font-salon-display-ext",
  adjustFontFallback: false,
});
const displayVietnamese = localFont({
  src: "../../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-vietnamese-standard-normal.woff2",
  variable: "--font-salon-display-vi",
  adjustFontFallback: false,
});
const text = localFont({
  src: "../../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-standard-normal.woff2",
  variable: "--font-salon-text",
  adjustFontFallback: false,
});
const textExt = localFont({
  src: "../../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-ext-standard-normal.woff2",
  variable: "--font-salon-text-ext",
  adjustFontFallback: false,
});

/** Put on the page's root so the variables below resolve. */
export const salonFontVars = [display, displayExt, displayVietnamese, text, textExt].map((f) => f.variable).join(" ");

export const DISPLAY =
  "var(--font-salon-display), var(--font-salon-display-ext), var(--font-salon-display-vi), 'Arial Narrow', sans-serif";
export const TEXT =
  "var(--font-salon-text), var(--font-salon-text-ext), var(--font-sans), var(--font-sans-vi), system-ui, sans-serif";

/** The big narrow capitals the headings are set in. */
export const displayStyle = {
  fontFamily: DISPLAY,
  fontVariationSettings: "'wdth' 75, 'opsz' 96",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "-0.02em",
  lineHeight: 0.9,
  textWrap: "balance",
} as const;

/** The site's fixed colours; the salon's own (--brand) goes on top. */
export const INK = "#16121A";
export const CREAM = "#FFF4E8";
export const MUTED = "#5A4F63";
export const LINE = "#D9CCE3";
