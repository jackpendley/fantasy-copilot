// Pure numbers behind the player card: where his points come from, how his season is
// distributed, and where tonight's game is heading. No I/O, so tests run them directly.

import type { ScoringMap } from "@fantasy-copilot/fantasy-core";

export interface Contribution {
  /** "PTS", "REB", ... or "FG" / "FT" (makes and misses together). */
  stat: string;
  /** What he averages: "8.1" or, for FG/FT, "8.1/17.3" (made/attempted). */
  detail: string;
  /** Fantasy points per game from it (net for FG/FT: makes minus misses). */
  points: number;
}

const BONUS = new Set(["DD", "TD", "QD"]);
const fmt = (v: number) => v.toFixed(1);

/**
 * Per-game fantasy points by stat, biggest first. Field goals and free throws are one net bar
 * each (made x their value + missed x theirs), so an efficient scorer shows green and an
 * inefficient one red. Stats worth nothing in this league, or zero for him, are left out.
 */
export function contributions(
  perGame: Record<string, number>,
  scoring: ScoringMap,
): Contribution[] {
  const w = (s: string) => scoring[s] ?? 0;
  const v = (s: string) => perGame[s] ?? 0;
  const out: Contribution[] = [];
  const shots = (made: string, att: string, miss: string, label: string) => {
    const m = v(made);
    const a = v(att) || m + v(miss);
    const points = m * w(made) + (a - m) * w(miss);
    if (a && (w(made) || w(miss))) out.push({ stat: label, detail: `${fmt(m)}/${fmt(a)}`, points });
  };
  shots("FGM", "FGA", "FGMI", "FG");
  shots("FTM", "FTA", "FTMI", "FT");
  const grouped = new Set(["FGM", "FGA", "FGMI", "FTM", "FTA", "FTMI"]);
  for (const [stat, pts] of Object.entries(scoring)) {
    if (grouped.has(stat) || BONUS.has(stat) || !pts) continue;
    const value = v(stat) || (stat === "3PMI" ? v("3PA") - v("3PM") : 0);
    if (!value) continue;
    out.push({ stat, detail: fmt(value), points: value * pts });
  }
  return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

export interface SeasonSplit {
  games: number;
  fppg: number;
  median: number;
  /** 25th and 75th percentile game: a typical bad night and a typical good one. */
  floor: number;
  ceiling: number;
  /** Standard deviation of his games (lower = steadier). */
  sd: number;
  best: number;
  worst: number;
  minutes: number;
  /** Fantasy points per 36 minutes and per minute. */
  per36: number;
  perMinute: number;
  /** Box score per game: MIN, PTS, REB, AST, STL, BLK, 3PM, TO, FG%, FT%. */
  box: Record<string, number>;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** One season from its games played (each with fantasy points and the box line). */
export function seasonSplit(
  games: { fp: number; line: Record<string, number> }[],
): SeasonSplit | null {
  const played = games.filter((g) => (g.line.MIN ?? 0) > 0);
  const n = played.length;
  if (!n) return null;
  const fps = played.map((g) => g.fp).sort((a, b) => a - b);
  const fppg = fps.reduce((a, b) => a + b, 0) / n;
  const sum = (k: string) => played.reduce((a, g) => a + (g.line[k] ?? 0), 0);
  const minutes = sum("MIN");
  const totalFp = fps.reduce((a, b) => a + b, 0);
  const box: Record<string, number> = {};
  for (const k of ["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"]) box[k] = sum(k) / n;
  box["FG%"] = sum("FGA") ? sum("FGM") / sum("FGA") : 0;
  box["FT%"] = sum("FTA") ? sum("FTM") / sum("FTA") : 0;
  return {
    games: n,
    fppg,
    median: quantile(fps, 0.5),
    floor: quantile(fps, 0.25),
    ceiling: quantile(fps, 0.75),
    sd: Math.sqrt(fps.reduce((a, x) => a + (x - fppg) ** 2, 0) / n),
    best: fps.at(-1)!,
    worst: fps[0]!,
    minutes: minutes / n,
    per36: minutes ? (totalFp / minutes) * 36 : 0,
    perMinute: minutes ? totalFp / minutes : 0,
    box,
  };
}

/**
 * Where tonight's game is heading: points so far plus his expected rate over the minutes he
 * should still play (his expected minutes less those played; none once the game is final).
 */
export function projectedFinal(a: {
  fp: number;
  minutes: number;
  expectedMinutes: number;
  /** Expected fantasy points per minute. */
  rate: number;
  final: boolean;
}): number {
  if (a.final) return a.fp;
  return a.fp + Math.max(0, a.expectedMinutes - a.minutes) * a.rate;
}
