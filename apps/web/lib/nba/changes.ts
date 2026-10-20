import "server-only";
// What happened in the league between two outlook runs: the roster moves (waiver claims,
// free-agent adds, trades) behind the odds changes, each valued in rest-of-season points.

import {
  fetchLeague,
  parsePlayerPool,
  parseTransactions,
  playerIdsFilter,
} from "@fantasy-copilot/espn";
import { espnConfig } from "@/lib/env";
import { LAST_SCORING_PERIOD } from "./calendar";
import { nbaSchedule } from "./data";
import { rawValue, valueContext } from "./trade";

export interface MovedPlayer {
  id: number;
  name: string;
  /** Projected points for the rest of the season (games he's expected to play). */
  ros: number;
}

export interface TeamMove {
  teamId: number;
  type: "WAIVER" | "FREEAGENT" | "TRADE";
  at: number;
  adds: MovedPlayer[];
  drops: MovedPlayer[];
  /** Rest-of-season points gained minus lost. */
  net: number;
}

/**
 * Roster moves processed after `from` and up to `to`. ESPN lists transactions by scoring
 * period, so every period between the two runs' start days is read.
 */
export async function leagueMovesBetween(
  from: Date,
  to: Date,
  fromPeriod: number,
  toPeriod: number,
): Promise<TeamMove[]> {
  if (process.env.ESPN_LEAGUE_FILE) return [];
  const cfg = espnConfig();
  const periods: number[] = [];
  for (let sp = Math.max(1, fromPeriod - 1); sp <= Math.max(fromPeriod, toPeriod); sp++) {
    periods.push(sp);
  }
  const lists = await Promise.all(
    periods.map((sp) =>
      fetchLeague(cfg, ["mTransactions2"], { scoringPeriodId: sp }).then(parseTransactions),
    ),
  );
  const seen = new Set<string>();
  const moves = lists
    .flat()
    .filter((t) => t.at > from.getTime() && t.at <= to.getTime())
    .filter((t) => {
      const key = `${t.teamId}:${t.at}:${t.adds.join(",")}:${t.drops.join(",")}`;
      return !seen.has(key) && seen.add(key);
    });
  if (!moves.length) return [];

  const ids = [...new Set(moves.flatMap((m) => [...m.adds, ...m.drops]))];
  const [raw, games] = await Promise.all([
    fetchLeague(cfg, ["kona_player_info"], {
      filter: playerIdsFilter(ids),
      scoringPeriodId: toPeriod,
    }),
    nbaSchedule(cfg.season),
  ]);
  const players = new Map(parsePlayerPool(raw, cfg.season).map((p) => [p.id, p]));
  // Regular weeks only matter for splitting value; one bucket is enough here.
  const ctx = valueContext(games, {}, toPeriod, LAST_SCORING_PERIOD, 99);
  const describe = (id: number): MovedPlayer => {
    const p = players.get(id);
    return { id, name: p?.name ?? `Player ${id}`, ros: p ? rawValue([p], ctx) : 0 };
  };
  return moves.map((m) => {
    const adds = m.adds.map(describe);
    const drops = m.drops.map(describe);
    const net = adds.reduce((a, p) => a + p.ros, 0) - drops.reduce((a, p) => a + p.ros, 0);
    return { teamId: m.teamId, type: m.type, at: m.at, adds, drops, net };
  });
}
