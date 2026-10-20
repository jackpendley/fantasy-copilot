import "server-only";
// Every player worth knowing about: all fantasy rosters plus the free-agent pool, each tagged
// with who owns him. Used by the players/trends pages.

import { fetchLeague, parseFreeAgents, playerIdsFilter } from "@fantasy-copilot/espn";
import { fetchGameLog } from "@fantasy-copilot/nba-data";
import { espnConfig } from "@/lib/env";
import { LAST_SCORING_PERIOD, etDate, scoringPeriodForDate } from "./calendar";
import { loadFreeAgents, loadLeague } from "./data";
import type { PoolPlayer } from "./trends";

export async function loadPlayerPool(now = new Date()) {
  const date = etDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const [data, freeAgents] = await Promise.all([loadLeague(sp, date), loadFreeAgents(sp)]);
  const pool: PoolPlayer[] = [
    ...data.teams.flatMap((t) =>
      t.roster.map((player) => ({
        player,
        owner: t.name,
        mine: t.id === data.me.id,
        available: false,
      })),
    ),
    ...freeAgents.map((f) => ({
      player: f.player,
      owner: f.status === "WAIVERS" ? "Waivers" : "Free agent",
      mine: false,
      available: true,
    })),
  ];
  return { sp, data, freeAgents, pool };
}

/**
 * One player's page data. Players outside the pool (deep free agents) are fetched by id.
 * The game log is this season's; before a player has a regular-season game it falls back to
 * last season, and says so.
 */
export async function loadPlayer(id: number, now = new Date()) {
  const { sp, data, freeAgents, pool } = await loadPlayerPool(now);
  let entry = pool.find((e) => e.player.id === id) ?? null;
  if (!entry && !process.env.ESPN_LEAGUE_FILE) {
    const cfg = espnConfig();
    const raw = await fetchLeague(cfg, ["kona_player_info"], {
      filter: playerIdsFilter([id]),
      scoringPeriodId: sp,
    });
    const f = parseFreeAgents(raw, cfg.season)[0];
    if (f)
      entry = {
        player: f.player,
        owner: f.status === "WAIVERS" ? "Waivers" : "Free agent",
        mine: false,
        available: true,
      };
  }
  if (!entry) return null;

  const season = Number(process.env.ESPN_SEASON || 2027);
  let log = await fetchGameLog(id, season).catch(() => []);
  let logSeason = season;
  if (!log.some((g) => g.part === "regular")) {
    const prev = await fetchGameLog(id, season - 1).catch(() => []);
    if (prev.length) {
      log = prev;
      logSeason = season - 1;
    }
  }
  const fa = freeAgents.find((f) => f.player.id === id) ?? null;
  const injury = data.injuries.find((i) => i.playerId === id) ?? null;
  return { entry, fa, injury, log, logSeason, season, scoring: data.settings.scoring };
}
