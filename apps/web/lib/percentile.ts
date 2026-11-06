// League percentiles on one 7-level scale for the whole app (ADR-061): dark green, green,
// light green, neutral, light red, red, dark red. Pure.

/** -3 (dark red) to 3 (dark green); 0 is neutral. */
export type PctLevel = -3 | -2 | -1 | 0 | 1 | 2 | 3;

/**
 * A percentile's level. `better`: "high" when a high percentile is good (the default; the app's
 * percentiles are mostly oriented that way already), "low" to flip one that isn't (turnovers,
 * fouls), null for a style stat that's neither (always neutral).
 */
export function pctLevel(
  p: number | null | undefined,
  better: "high" | "low" | null = "high",
): PctLevel | null {
  if (p == null || !Number.isFinite(p)) return null;
  if (better == null) return 0;
  const r = Math.round(better === "low" ? 100 - p : p);
  if (r >= 90) return 3;
  if (r >= 75) return 2;
  if (r >= 60) return 1;
  if (r >= 41) return 0;
  if (r >= 26) return -1;
  if (r >= 11) return -2;
  return -3;
}

/** Background fill per level (tiles, badges); text on it stays in the normal ink. */
export const PCT_FILL: Record<PctLevel, string> = {
  [-3]: "bg-pct-n3",
  [-2]: "bg-pct-n2",
  [-1]: "bg-pct-n1",
  0: "bg-pct-z",
  1: "bg-pct-p1",
  2: "bg-pct-p2",
  3: "bg-pct-p3",
};

/** Text color per level (dense tables), stronger levels a little bolder. */
export const PCT_INK: Record<PctLevel, string> = {
  [-3]: "text-pct-ink-n3 font-bold",
  [-2]: "text-pct-ink-n2 font-semibold",
  [-1]: "text-pct-ink-n1 font-medium",
  0: "text-foreground",
  1: "text-pct-ink-p1 font-medium",
  2: "text-pct-ink-p2 font-semibold",
  3: "text-pct-ink-p3 font-bold",
};

/** "94th". */
export function ordinal(n: number): string {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][r % 10] ?? "th");
  return `${r}${s}`;
}
