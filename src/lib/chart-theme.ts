/**
 * One set of chart colours for the whole CRM.
 *
 * Recharts styles its SVG through props rather than classes, so it cannot read
 * the Tailwind theme tokens and every chart ended up carrying its own hardcoded
 * palette. The dashboard drew axes in #94a3b8 on a #0d1117 tooltip; Insights
 * drew them in #64748b on #0f172a with a #334155 border. Two charts, two
 * looks, in the same product.
 *
 * These values mirror the tokens in globals.css. If the palette there changes,
 * change it here too — the duplication is forced by the library, so the best
 * available fix is to have exactly one copy of it.
 */

/** --card */
export const CHART_SURFACE = "#161b22";
/** --background */
export const CHART_BACKDROP = "#0d1117";
/** --muted-foreground, 8.3:1 on the card — axis labels are small text. */
export const CHART_AXIS = "#b4bcc8";
/** --border at the opacity gridlines want. */
export const CHART_GRID = "rgba(255,255,255,0.07)";

/** Series colours, ordered for first-in-chart legibility on the dark surface. */
export const CHART_SERIES = [
  "#60a5fa", // blue
  "#34d399", // green
  "#fbbf24", // amber
  "#f87171", // red
  "#a78bfa", // violet
] as const;

/** Applied to Recharts' <Tooltip contentStyle>. */
export const CHART_TOOLTIP = {
  background: CHART_SURFACE,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  fontSize: 12,
  color: "#e6edf3",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
} as const;

/** Applied to <XAxis>/<YAxis> `tick`. */
export const CHART_TICK = { fontSize: 11, fill: CHART_AXIS } as const;

/** Sentiment keeps meaning-bearing colours rather than the series order. */
export const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#34d399",
  neutral: "#94a3b8",
  negative: "#f87171",
};
