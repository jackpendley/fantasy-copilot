import "server-only";
// Who was ruled out on past game days, from the statuses the app logged (status_events): the
// Matchup board shows no projection for them (lib/nba/h2h.ts pastOut).

import { db, dbConfigured } from "@/lib/db";

/** Normalized statuses that mean he won't play that day. */
const OUT_STATUSES = ["OUT", "INJURY_RESERVE", "SUSPENSION", "INACTIVE"];

/** "playerId|YYYY-MM-DD" for every player whose last logged status that game day was out. */
export async function outOnDays(ids: number[], dates: string[]): Promise<Set<string>> {
  if (!dbConfigured() || !ids.length || !dates.length) return new Set();
  const rows = await db()<{ player_id: number; d: string; status: string }[]>`
    select distinct on (player_id, game_date) player_id, to_char(game_date, 'YYYY-MM-DD') as d,
      status
    from status_events
    where player_id = any(${ids}) and game_date = any(${dates}::date[])
      and source in ('espn_injuries', 'nba_injury_report', 'nba_lineups', 'espn_fantasy')
    order by player_id, game_date, observed_at desc
  `;
  return new Set(
    rows.filter((r) => OUT_STATUSES.includes(r.status)).map((r) => `${r.player_id}|${r.d}`),
  );
}
