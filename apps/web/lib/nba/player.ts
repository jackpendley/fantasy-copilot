// A player's games scored under this league's rules, with a rolling average and summary.

import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";

export interface GameRow extends GameLogEntry {
  fp: number;
  /** Average of the last `window` games through this one (null until there are enough). */
  rolling: number | null;
}

export function scoreGames(log: GameLogEntry[], scoring: ScoringMap, window = 5): GameRow[] {
  const games = log.filter((g) => g.part !== "pre");
  const rows: GameRow[] = [];
  games.forEach((g, i) => {
    const fp = fantasyPoints(withDerived(g.line), scoring);
    const recent = [...rows.slice(Math.max(0, i - window + 1)).map((r) => r.fp), fp];
    rows.push({ ...g, fp, rolling: recent.length >= window ? avg(recent) : null });
  });
  return rows;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface PlayerSummary {
  games: number;
  fppg: number | null;
  last5: number | null;
  minutes: number | null;
  minutesLast5: number | null;
}

/** Season averages are regular season only; "last 5" is the latest games played, playoffs included. */
export function summarize(rows: GameRow[]): PlayerSummary {
  const played = rows.filter((r) => (r.line.MIN ?? 0) > 0);
  const regular = played.filter((r) => r.part === "regular");
  const last5 = played.slice(-5);
  return {
    games: regular.length,
    fppg: regular.length ? avg(regular.map((r) => r.fp)) : null,
    last5: last5.length ? avg(last5.map((r) => r.fp)) : null,
    minutes: regular.length ? avg(regular.map((r) => r.line.MIN ?? 0)) : null,
    minutesLast5: last5.length ? avg(last5.map((r) => r.line.MIN ?? 0)) : null,
  };
}
