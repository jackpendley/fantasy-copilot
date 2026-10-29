import "server-only";
// Opponent defense against each position (MODEL_CARD: passed 2026-10-29). Every player-game
// this season pairs our pregame projection (pregame_projections) with what he scored
// (game_results); the projection is taken without the factor itself (pregame_projections
// .matchup_factor), so the table never feeds on its own output. For each opponent and position, the factor is what players actually scored
// over what we projected, shrunk toward 1 by 200 player-games: f = (n r + 200) / (n + 200).
// The nightly job recomputes it before the day's games (point in time) and stores it in
// model_settings; pages read it (cached 30 minutes) and multiply a game's projection by it.

import { db } from "@/lib/db";
import { espnConfig } from "@/lib/env";
import { nbaSchedule } from "./data";
import { loadPlayerPool } from "./pool";
import { DEFENSE_KEY, forgetDefenseTable, type DefenseSetting } from "./defense-table";

const SHRINK = 200;

/** Nightly: recompute from every logged projection with a result. */
export async function refreshDefense(now = new Date()): Promise<{ keys: number; games: number }> {
  const [rows, games, pool] = await Promise.all([
    db()<{ game_id: number; player_id: number; team_id: number; model: number; fp: number }[]>`
      select p.game_id, p.player_id, r.team_id,
        p.model_fppg / coalesce(nullif(p.matchup_factor, 0), 1) as model, r.fp
      from pregame_projections p join game_results r using (game_id, player_id)
      where p.snapshot = 'pregame' and p.model_fppg is not null and p.model_fppg > 0
    `,
    nbaSchedule(espnConfig().season),
    loadPlayerPool(now),
  ]);
  const position = new Map(pool.pool.map((e) => [e.player.id, e.player.positions[0]]));
  const teams = new Map(games.map((g) => [g.gameId, [g.homeProTeamId, g.awayProTeamId]]));
  const sums = new Map<string, { a: number; p: number; n: number }>();
  for (const r of rows) {
    const pos = position.get(r.player_id);
    const pair = teams.get(Number(r.game_id));
    if (!pos || !pair) continue;
    const opp = pair[0] === r.team_id ? pair[1] : pair[1] === r.team_id ? pair[0] : null;
    if (opp == null) continue;
    const key = `${opp}|${pos}`;
    const s = sums.get(key) ?? { a: 0, p: 0, n: 0 };
    sums.set(key, { a: s.a + r.fp, p: s.p + r.model, n: s.n + 1 });
  }
  const value: DefenseSetting = { asOf: now.toISOString(), factors: {}, games: {} };
  for (const [key, s] of sums) {
    value.factors[key] = (s.n * (s.a / s.p) + SHRINK) / (s.n + SHRINK);
    value.games[key] = s.n;
  }
  await db()`
    insert into model_settings (key, value) values (${DEFENSE_KEY}, ${db().json(value as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  forgetDefenseTable();
  return { keys: sums.size, games: rows.length };
}
