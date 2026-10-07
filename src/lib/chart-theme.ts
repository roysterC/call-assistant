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
export const CHART_SURFACE = "#ffffff";
/** --background */
export const CHART_BACKDROP = "#fbfbf4";
/** --muted-foreground, 6.2:1 on the card — axis labels are small text. */
export const CHART_AXIS = "#5b6635";
/** --border, which is exactly what gridlines want on white. */
export const CHART_GRID = "#ebeedf";

/** Series colours, ordered for first-in-chart legibility on a white surface. */
export const CHART_SERIES = [
  "#5b6635", // tea green 200 (the accent)
  "#c58341", // light bronze 400
  "#a57b10", // papaya whip 200
  "#79842c", // beige 200
  "#96622e", // light bronze 300
] as const;

/** Applied to Recharts' <Tooltip contentStyle>. */
export const CHART_TOOLTIP = {
  background: CHART_SURFACE,
  border: "1px solid #e1e6cf",
  borderRadius: 10,
  fontSize: 12,
  color: "#2d331a",
  boxShadow: "0 4px 6px -2px rgba(45,51,26,0.05), 0 12px 24px -6px rgba(45,51,26,0.12)",
} as const;

/** Applied to <XAxis>/<YAxis> `tick`. */
export const CHART_TICK = { fontSize: 11, fill: CHART_AXIS } as const;
