// Live scoring for today's games: how far along each game is, and each player's fantasy
// points so far (ESPN) plus what he's projected to add before his game ends.

import type { LiveEntry } from "@fantasy-copilot/espn";
import type { ScoreboardGame } from "@fantasy-copilot/nba-data";
import type { DayRow } from "./day";

/** Share of regulation played: 0 before tip, 1 when final or in overtime. */
export function gameElapsed(g: Pick<ScoreboardGame, "state" | "period" | "clock">): number {
  if (g.state === "pre") return 0;
  if (g.state === "post" || g.period > 4) return 1;
  // "5:12", or seconds only ("45.2") in a quarter's last minute.
  const [a, b] = g.clock.split(":");
  const left = b === undefined ? Number(a) / 60 : Number(a) + Number(b) / 60;
  const played = (Math.max(g.period, 1) - 1) * 12 + (12 - (Number.isFinite(left) ? left : 12));
  return Math.min(1, Math.max(0, played / 48));
}

export const isStarting = (slot: string) => slot !== "BE" && slot !== "IR";

export type Trend = "up" | "down" | null;

/**
 * Running well above or below the pregame projection: at least 5 points and 20% away.
 * Small projections need the 5 points; big ones need the 20%.
 */
export function trendOf(pregame: number, projected: number): Trend {
  const gap = projected - pregame;
  const bar = Math.max(5, 0.2 * pregame);
  return gap >= bar ? "up" : gap <= -bar ? "down" : null;
}

export interface LiveRow {
  row: DayRow;
  /** Today's slot as ESPN has it. */
  slot: string;
  starting: boolean;
  points: number;
  /** Projected points still to come today (0 on the bench or once his game is over). */
  toCome: number;
  /** Expected points before tip (fixed for the day: today's game doesn't feed it). */
  pregame: number;
  /** Points so far plus the unplayed share of the pregame projection; final once it's over. */
  projected: number;
  trend: Trend;
  /** Today's box score from ESPN, once his game has started. */
  line: Record<string, number> | null;
  /** His team's score and the opponent's, once the game has started. */
  score: { us: number; them: number } | null;
  elapsed: number;
}

export function liveRows(
  board: DayRow[],
  live: LiveEntry[] | undefined,
  scoreboard: ScoreboardGame[],
): LiveRow[] {
  const byPlayer = new Map((live ?? []).map((e) => [e.playerId, e]));
  const games = new Map(scoreboard.map((g) => [g.gameId, g]));
  return board.map((row) => {
    const entry = byPlayer.get(row.player.id);
    const slot = entry?.slot ?? row.currentSlot;
    const sb = row.game ? games.get(row.game.gameId) : undefined;
    const elapsed = sb ? gameElapsed(sb) : 0;
    const starting = isStarting(slot);
    const score =
      sb && sb.state !== "pre" && sb.homeScore != null && sb.awayScore != null
        ? row.game!.home
          ? { us: sb.homeScore, them: sb.awayScore }
          : { us: sb.awayScore, them: sb.homeScore }
        : null;
    const points = entry?.points ?? 0;
    const started = Boolean(row.game && row.game.state !== "pre");
    const projected = started ? points + row.value * (1 - elapsed) : row.value;
    return {
      row,
      slot,
      starting,
      points,
      toCome: starting && row.game ? row.value * (1 - elapsed) : 0,
      pregame: row.value,
      projected,
      trend: started ? trendOf(row.value, projected) : null,
      line: entry?.line ?? null,
      score,
      elapsed,
    };
  });
}

/** Order for display: games in progress, then finished, then not started; points within each. */
export function sortLive(rows: LiveRow[]): LiveRow[] {
  const rank = (r: LiveRow) =>
    !r.row.game ? 3 : r.row.game.state === "in" ? 0 : r.row.game.state === "post" ? 1 : 2;
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || b.points - a.points || b.row.value - a.row.value,
  );
}

/** The scoring stats on one line, zeros left out: "22 PTS 9 REB 1 AST 1 STL 1 BLK". */
export function statSummary(line: Record<string, number> | null): string | null {
  if (!line) return null;
  const parts = (
    [
      ["PTS", "PTS"],
      ["REB", "REB"],
      ["AST", "AST"],
      ["STL", "STL"],
      ["BLK", "BLK"],
      ["3PM", "3PM"],
    ] as const
  )
    .filter(([k]) => (line[k] ?? 0) !== 0)
    .map(([k, label]) => `${line[k]} ${label}`);
  return parts.length ? parts.join(" ") : "0 PTS";
}
