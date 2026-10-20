// Per-game fantasy points used for lineup decisions until the ML models land (ROADMAP phase 5):
// ESPN's preseason projection (already scored with this league's settings), shrunk toward
// this season's actual average as games accumulate.

import type { RosterPlayer } from "@fantasy-copilot/espn";

/** Games of actual data that count as much as the preseason projection. */
const PRIOR_GAMES = 15;

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

/** `asOf`: ignore games from this scoring period on (a pregame projection for that day). */
export function perGameProjection(p: RosterPlayer, asOf?: number): PerGame {
  const proj = p.projection?.avg ?? null;
  const season = seasonBefore(p, asOf);
  const seasonAvg = season?.avg ?? null;
  const gp = seasonAvg && season?.total ? Math.round(season.total / seasonAvg) : 0;
  if (proj == null && seasonAvg == null) return { fppg: 0, gamesPlayed: 0, source: "none" };
  if (proj == null) return { fppg: seasonAvg!, gamesPlayed: gp, source: "season" };
  if (!gp || seasonAvg == null) return { fppg: proj, gamesPlayed: 0, source: "projection" };
  const w = gp / (gp + PRIOR_GAMES);
  return { fppg: w * seasonAvg + (1 - w) * proj, gamesPlayed: gp, source: "blend" };
}
