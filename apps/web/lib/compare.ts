// Comparing two players row by row (the Moves page's Compare): which side is better. Pure.

export type Better = "high" | "low" | null;

export interface Row {
  label: string;
  a: string | null;
  b: string | null;
  /** Numbers compared to pick the better one (null: no winner shown). */
  av?: number | null;
  bv?: number | null;
  better?: Better;
  /** League percentiles shown beside the values. */
  ap?: number | null;
  bp?: number | null;
}

/** Which side wins a row: "a", "b" or null (tie, unknown, or a style stat). */
export function winner(r: Row): "a" | "b" | null {
  if (!r.better || r.av == null || r.bv == null || r.av === r.bv) return null;
  const aWins = r.better === "high" ? r.av > r.bv : r.av < r.bv;
  return aWins ? "a" : "b";
}
