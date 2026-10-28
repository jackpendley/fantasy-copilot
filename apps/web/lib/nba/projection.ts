// Per-game fantasy points used for lineup decisions until the ML models land (ROADMAP phase 5):
// ESPN's preseason projection (already scored with this league's settings), shrunk toward
// this season's actual average as games accumulate, then scaled by his recent minutes trend.
// Changes here must pass the walk-forward backtest in docs/MODEL_CARD.md.

import type { RosterPlayer } from "@fantasy-copilot/espn";

/** Games of actual data that count as much as the preseason projection. */
const PRIOR_GAMES = 15;
/**
 * Prior for a player ESPN didn't project (it didn't consider him rosterable): the median
 * ESPN projection among projected free agents, 15.0 FP/G on Oct 27, 2026. His games are
 * blended toward it like anyone's, so one big night doesn't make him a starter.
 */
const UNPROJECTED_PRIOR = 15;
/** Minutes trend (MODEL_CARD.md): last 5 games' minutes vs his season, once he has 8 games. */
const TREND_WINDOW = 5;
const TREND_MIN_GAMES = 8;
const TREND_STRENGTH = 0.5;

export interface PerGame {
  fppg: number;
  gamesPlayed: number;
  source: "projection" | "blend" | "season" | "none";
}

/**
 * Season to date as it stood before scoring period `asOf`: ESPN folds a game into the season
 * line as soon as it's played, so without this a player's projection would move during and
 * after his own game.
 */
function seasonBefore(
  p: RosterPlayer,
  asOf?: number,
): { avg: number | null; total: number } | null {
  const avg = p.season?.avg ?? null;
  const total = p.season?.total ?? null;
  if (avg == null || total == null) return null;
  const later = asOf == null ? [] : (p.games ?? []).filter((g) => g.scoringPeriodId >= asOf);
  if (!later.length) return { avg, total };
  const gp = (avg ? Math.round(total / avg) : 0) - later.length;
  const rest = total - later.reduce((a, g) => a + g.points, 0);
  return gp > 0 ? { avg: rest / gp, total: rest } : null;
}

/**
 * Role changes show up in minutes first: scale by recent minutes over season minutes
 * (clipped to 0.6-1.4, half strength). Only games before `asOf` count.
 */
export function minutesTrend(p: RosterPlayer, asOf?: number): number {
  const mins = (p.games ?? [])
    .filter((g) => asOf == null || g.scoringPeriodId < asOf)
    .map((g) => g.line.MIN ?? 0)
    .filter((m) => m > 0);
  if (mins.length < TREND_MIN_GAMES) return 1;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ratio = Math.min(1.4, Math.max(0.6, avg(mins.slice(-TREND_WINDOW)) / avg(mins)));
  return 1 + TREND_STRENGTH * (ratio - 1);
}

/** `asOf`: ignore games from this scoring period on (a pregame projection for that day). */
export function perGameProjection(p: RosterPlayer, asOf?: number): PerGame {
  const proj = p.projection?.avg ?? null;
  const season = seasonBefore(p, asOf);
  const seasonAvg = season?.avg ?? null;
  const gp = seasonAvg && season?.total ? Math.round(season.total / seasonAvg) : 0;
  if (proj == null && seasonAvg == null) return { fppg: 0, gamesPlayed: 0, source: "none" };
  const trend = minutesTrend(p, asOf);
  if (proj == null) {
    const w = gp / (gp + PRIOR_GAMES);
    return {
      fppg: (w * seasonAvg! + (1 - w) * UNPROJECTED_PRIOR) * trend,
      gamesPlayed: gp,
      source: "season",
    };
  }
  if (!gp || seasonAvg == null) return { fppg: proj, gamesPlayed: 0, source: "projection" };
  const w = gp / (gp + PRIOR_GAMES);
  return { fppg: (w * seasonAvg + (1 - w) * proj) * trend, gamesPlayed: gp, source: "blend" };
}

/** Game environment (MODEL_CARD.md, passed 2026-10-21): (team's implied points ÷ league)^0.75. */
const ENV_BETA = 0.75;
/**
 * League-average implied team total. 2025-26's closing lines averaged 115.3 (2024-25: 113.3).
 * A fixed value moves every game's factor alike, so start/sit choices and head-to-head odds
 * barely depend on it; replace it with this season's average once lines are collected.
 */
export const LEAGUE_TEAM_TOTAL = 115.3;

/** A game's line as the scoreboard has it: total and home spread (negative = home favored). */
export interface GameLine {
  total: number | null;
  spread: number | null;
}

/** Multiplier for one game from its line; 1 when there's no line. */
export function gameEnvironment(line: GameLine | null | undefined, home: boolean): number {
  if (line?.total == null || line.spread == null) return 1;
  const team = home ? (line.total - line.spread) / 2 : (line.total + line.spread) / 2;
  return Math.pow(team / LEAGUE_TEAM_TOTAL, ENV_BETA);
}
