// A player's fantasy projection for one game implied by sportsbook props. Pure.
//
// Each over/under (with the margin removed) pins down the expected stat: points, rebounds and
// assists as over-dispersed normals, threes, steals and blocks as Poisson counts. This league
// scores the parts of a basket (makes, misses, free throws), not points, so the points line
// scales the model's shooting volume. Stats without a prop (turnovers) keep the model's
// number. The model's per-game line is ESPN's projected box score scaled to our FP/G.

import type { PropLine, PropMarket } from "@fantasy-copilot/nba-data";
import { noVigOver } from "@fantasy-copilot/nba-data";

/** Game-to-game variance as a multiple of the mean (NBA box scores, rough). */
const VARIANCE_RATIO: Partial<Record<PropMarket, number>> = { PTS: 2.5, REB: 1.3, AST: 1.35 };

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function poissonCdf(k: number, mean: number): number {
  let term = Math.exp(-mean);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= mean / i;
    sum += term;
  }
  return sum;
}

/** P(stat > line) for a mean, under the market's distribution. */
export function overProbability(market: PropMarket, line: number, mean: number): number {
  const ratio = VARIANCE_RATIO[market];
  if (ratio) return 1 - normalCdf((line - mean) / Math.sqrt(ratio * Math.max(mean, 0.01)));
  return 1 - poissonCdf(Math.floor(line), mean);
}

/** The mean that makes the over as likely as the book says (bisection; P(over) rises with the mean). */
export function impliedMean(prop: PropLine): number {
  const target = noVigOver(prop.over, prop.under);
  let lo = 0.001;
  let hi = prop.line * 3 + 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (overProbability(prop.market, prop.line, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Fantasy points of a per-game box score (misses derived; no double-double bonuses, like ESPN's averages). */
export function boxPoints(stats: Record<string, number>, scoring: Record<string, number>): number {
  const line: Record<string, number> = { ...stats };
  if (stats.FGA != null && stats.FGM != null) line.FGMI = stats.FGA - stats.FGM;
  if (stats.FTA != null && stats.FTM != null) line.FTMI = stats.FTA - stats.FTM;
  if (stats["3PA"] != null && stats["3PM"] != null) line["3PMI"] = stats["3PA"] - stats["3PM"];
  let total = 0;
  for (const [stat, pts] of Object.entries(scoring)) {
    if (stat === "DD" || stat === "TD" || stat === "QD") continue;
    total += (line[stat] ?? 0) * pts;
  }
  return total;
}

const SHOOTING = ["PTS", "FGM", "FGA", "FTM", "FTA"];

export interface VegasProjection {
  /** Fantasy points for this game implied by the props. */
  fppg: number;
  /** The expected stat behind each prop. */
  means: Partial<Record<PropMarket, number>>;
}

/**
 * Props → fantasy points. `modelStats` is ESPN's projected per-game box score and
 * `modelFppg` our projection; the box score is scaled to match it before props replace the
 * stats they cover. Needs a points line (shooting is most of the score); null otherwise.
 */
export function vegasProjection(
  props: PropLine[],
  modelStats: Record<string, number> | null | undefined,
  modelFppg: number,
  scoring: Record<string, number>,
): VegasProjection | null {
  if (!modelStats || modelFppg <= 0) return null;
  const means: Partial<Record<PropMarket, number>> = {};
  for (const p of props) means[p.market] = impliedMean(p);
  if (means.PTS == null) return null;
  const baseFp = boxPoints(modelStats, scoring);
  if (baseFp <= 0) return null;
  const scale = modelFppg / baseFp;
  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(modelStats)) stats[k] = v * scale;
  if (!stats.PTS) return null;

  const shooting = means.PTS / stats.PTS;
  for (const k of SHOOTING) if (stats[k] != null) stats[k] *= shooting;
  if (means["3PM"] == null) {
    if (stats["3PM"] != null) stats["3PM"] *= shooting;
    if (stats["3PA"] != null) stats["3PA"] *= shooting;
  }
  for (const m of ["REB", "AST", "STL", "BLK", "3PM"] as const) {
    if (means[m] != null) stats[m] = means[m]!;
  }
  return { fppg: boxPoints(stats, scoring), means };
}
