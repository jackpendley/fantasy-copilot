import "server-only";
// This season's league-average implied team total, from the game lines collected so far
// (game_lines: closing line first, else the pregame or morning capture). The game-environment
// factor divides each team's implied total by it: the tested model (MODEL_CARD, game
// environment) used this point-in-time average, from games before each day, once 40
// team-games were in. Before that, or without a database, the 2025-26 average stands in.

import { db, dbConfigured } from "@/lib/db";

const MIN_TEAM_GAMES = 40;
const FRESH_MS = 3 * 3600_000;
let cached: { before: string; at: number; value: Promise<number | null> } | null = null;

/** The average implied team total over games before `date` (an ET game date); null if too few. */
export function leagueTeamTotal(date: string): Promise<number | null> {
  if (!dbConfigured()) return Promise.resolve(null);
  if (cached && cached.before === date && Date.now() - cached.at < FRESH_MS) return cached.value;
  // 9:00 UTC is 4-5 AM ET: after the latest West Coast tip of the day before.
  const cutoff = new Date(`${date}T09:00:00Z`);
  const value = db()<{ games: number; total: number | null }[]>`
    select count(*)::int as games, avg(total) as total from (
      select distinct on (game_id) total from game_lines
      where tip < ${cutoff} and total is not null and spread is not null
      order by game_id,
        case snapshot when 'close' then 0 when 'pregame' then 1 else 2 end
    ) g
  `.then(([r]) => (r && 2 * r.games >= MIN_TEAM_GAMES && r.total ? r.total / 2 : null));
  cached = { before: date, at: Date.now(), value };
  value.catch(() => {
    if (cached?.value === value) cached = null;
  });
  return value;
}
