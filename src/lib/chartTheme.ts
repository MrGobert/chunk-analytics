/**
 * Recharts colour source of truth.
 *
 * Recharts writes `stroke`/`fill` as SVG *presentation attributes*, where CSS
 * `var(--token)` does NOT resolve — so series colours must be literal hex. This
 * module mirrors the Paper & Ember tokens for SVG-land; the CSS variables in
 * globals.css remain the source of truth for everything in the DOM.
 *
 * Rules from the design system:
 *  - Ember is rare. It is deliberately ABSENT from the categorical rotation and
 *    only appears when a page explicitly opts in via `chart.primary` (budget one
 *    ember chart per viewport — typically the MRR trend).
 *  - Butter is a fill, never a stroke or text (thin butter on cream ~1.6:1).
 *  - Sage = good, ember-deep = bad (trend directions).
 */

export const chart = {
  /** Categorical series order on cream. Default everywhere is lake (series[0]). */
  series: [
    "#3E7CB1", // lake
    "#5B8A5E", // sage
    "#BD3717", // ember-deep
    "#C8922A", // butter-deep (derived — ≥3:1 on card)
    "#2F628F", // lake-deep
    "#477349", // sage-deep
    "#6B5D4F", // ink-soft
    "#9B8A77", // warm neutral
  ],

  /** Opt-in hero series only. Keep to one ember chart per viewport. */
  primary: "#E84D2B", // ember

  /** Soft accent fills (areas/bars/heatmap), never strokes or text. */
  butter: "#F5BE4F",
  lake: "#3E7CB1",
  lakeTint: "#DBEAF5",
  sage: "#5B8A5E",
  emberDeep: "#BD3717",

  /** Grid / axis / cursor on cream. */
  grid: "rgba(45, 36, 24, 0.08)",
  axis: "#6B5D4F", // ink-soft — use 12px ticks (ink-faint is only AA ≥13px)
  cursor: "rgba(45, 36, 24, 0.04)",

  /** Tooltip — card surface, warm shadow, mono. */
  tooltip: {
    backgroundColor: "#FFFDF8",
    border: "1px solid rgba(45, 36, 24, 0.10)",
    borderRadius: "12px",
    boxShadow: "0 1px 2px rgba(45,36,24,0.06), 0 8px 24px rgba(93,64,28,0.08)",
    fontFamily: "var(--font-spline-mono), monospace",
    fontSize: "12px",
    color: "#2D2418",
  } as const,
  tooltipLabelStyle: { color: "#6B5D4F", fontWeight: 600 } as const,
  tooltipItemStyle: { color: "#2D2418" } as const,

  /** Slice/separator stroke (paper-cutout look on pies). */
  cardStroke: "#FFFDF8",
} as const;

/** Convenience: a categorical colour by index, wrapping the palette. */
export function seriesColor(i: number): string {
  return chart.series[i % chart.series.length];
}
