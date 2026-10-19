// League scoring: fantasy points from a stat line and a { STAT: points } map.

export type StatLine = Record<string, number>;
export type ScoringMap = Record<string, number>;

const MULTI_CATS = ["PTS", "REB", "AST", "STL", "BLK"] as const;

/**
 * Fill stats a league may score but a box score doesn't list: misses and
 * double/triple/quadruple-doubles. Existing values are kept.
 */
export function withDerived(line: StatLine): StatLine {
  const out = { ...line };
  const has = (k: string) => out[k] != null;
  if (!has("FGMI") && has("FGA") && has("FGM")) out.FGMI = out.FGA! - out.FGM!;
  if (!has("FTMI") && has("FTA") && has("FTM")) out.FTMI = out.FTA! - out.FTM!;
  if (!has("3PMI") && has("3PA") && has("3PM")) out["3PMI"] = out["3PA"]! - out["3PM"]!;
  if (MULTI_CATS.every((k) => has(k)) && !has("DD")) {
    const tens = MULTI_CATS.filter((k) => out[k]! >= 10).length;
    out.DD = tens >= 2 ? 1 : 0;
    out.TD = tens >= 3 ? 1 : 0;
    out.QD = tens >= 4 ? 1 : 0;
  }
  return out;
}

export function fantasyPoints(line: StatLine, points: ScoringMap): number {
  let total = 0;
  for (const [stat, pts] of Object.entries(points)) total += (line[stat] ?? 0) * pts;
  return total;
}

/** ESPN `scoringSettings.scoringItems` -> ScoringMap, using a stat id -> abbreviation table. */
export function scoringFromEspn(
  items: readonly { statId: number; points: number }[],
  statById: Record<number, string>,
): ScoringMap {
  const map: ScoringMap = {};
  for (const { statId, points } of items) {
    const stat = statById[statId];
    if (stat) map[stat] = points;
  }
  return map;
}
