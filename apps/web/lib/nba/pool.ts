import "server-only";
// Every player worth knowing about: all fantasy rosters plus the free-agent pool, each tagged
// with who owns him. Used by the players/trends pages.

import { fetchLeague, parseFreeAgents, playerIdsFilter } from "@fantasy-copilot/espn";
import { fetchGameLog } from "@fantasy-copilot/nba-data";
import { espnConfig } from "@/lib/env";
import { LAST_SCORING_PERIOD, scoringPeriodForDate, gameDate } from "./calendar";
import { loadFreeAgents, loadLeague } from "./data";
import type { PoolPlayer } from "./trends";
import { perGameProjection } from "./projection";
import type { SearchPlayer } from "@/lib/player-search";

export async function loadPlayerPool(now = new Date()) {
  const date = gameDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const [league, freeAgents] = await Promise.all([loadLeague(sp, date), loadFreeAgents(sp)]);
  // Who owns whom, counting moves that take effect tomorrow.
  const data = { ...league, teams: league.ahead.teams, me: league.ahead.me };
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

/** Free agents in the search index: everyone ESPN lists, most-owned first. */
const INDEX_FREE_AGENTS = 1000;

/** Every player for search as you type: all fantasy rosters plus every free agent. */
export async function loadSearchIndex(now = new Date()): Promise<SearchPlayer[]> {
  const date = gameDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const [league, freeAgents] = await Promise.all([
    loadLeague(sp, date),
    loadFreeAgents(sp, INDEX_FREE_AGENTS),
  ]);
  const entry = (p: (typeof freeAgents)[number]["player"], owner: string, mine: boolean) => ({
    id: p.id,
    name: p.name,
    team: p.proTeam,
    positions: p.positions,
    owner: mine ? "Your team" : owner,
    mine,
    available: owner === "Free agent" || owner === "Waivers",
    status: p.injuryStatus ?? "ACTIVE",
    fppg: Math.round(perGameProjection(p).fppg * 10) / 10,
    owned: Math.round((p.percentOwned ?? 0) * 10) / 10,
  });
  const seen = new Set<number>();
  const out: SearchPlayer[] = [];
  for (const t of league.ahead.teams)
    for (const p of t.roster)
      if (!seen.has(p.id)) {
        seen.add(p.id);
        out.push(entry(p, t.name, t.id === league.ahead.me.id));
      }
  for (const f of freeAgents)
    if (!seen.has(f.player.id)) {
      seen.add(f.player.id);
      out.push(entry(f.player, f.status === "WAIVERS" ? "Waivers" : "Free agent", false));
    }
  return out;
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
