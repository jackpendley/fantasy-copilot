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

export function perGameProjection(p: RosterPlayer): PerGame {
  const proj = p.projection?.avg ?? null;
  const seasonAvg = p.season?.avg ?? null;
  const gp = seasonAvg && p.season?.total ? Math.round(p.season.total / seasonAvg) : 0;
  if (proj == null && seasonAvg == null) return { fppg: 0, gamesPlayed: 0, source: "none" };
  if (proj == null) return { fppg: seasonAvg!, gamesPlayed: gp, source: "season" };
  if (!gp || seasonAvg == null) return { fppg: proj, gamesPlayed: 0, source: "projection" };
  const w = gp / (gp + PRIOR_GAMES);
  return { fppg: w * seasonAvg + (1 - w) * proj, gamesPlayed: gp, source: "blend" };
}
