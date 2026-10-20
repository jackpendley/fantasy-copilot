import "server-only";
// Live loaders. Pages read ESPN and the NBA feeds directly (a handful of parallel requests,
// ~100-300 ms each), so the app works as soon as the ESPN cookies are set. The database
// comes in with history-dependent features (alerts, news latency, ML).

import {
  fetchLeague,
  fetchProSchedule,
  freeAgentFilter,
  parseFreeAgents,
  parseMatchups,
  parseProSchedule,
  parseSettings,
  parseTeams,
  type ProGame,
} from "@fantasy-copilot/espn";
import {
  fetchDailyLineups,
  fetchInjuries,
  fetchScoreboard,
  type InjuryReport,
} from "@fantasy-copilot/nba-data";
import { readFile } from "node:fs/promises";
import { espnConfig } from "../env";

// The NBA schedule is ~400 KB and changes rarely: keep it in memory for 6 hours.
let scheduleCache: { at: number; games: ProGame[] } | null = null;
export async function nbaSchedule(season: number): Promise<ProGame[]> {
  if (scheduleCache && Date.now() - scheduleCache.at < 6 * 3600_000) return scheduleCache.games;
  const games = parseProSchedule(await fetchProSchedule(season));
  scheduleCache = { at: Date.now(), games };
  return games;
}

/** Injuries never block a page: an outage just means no injury notes. */
async function safeInjuries(): Promise<{ list: InjuryReport[]; error: string | null }> {
  try {
    return { list: await fetchInjuries(), error: null };
  } catch (e) {
    return { list: [], error: (e as Error).message };
  }
}

const LEAGUE_VIEWS = ["mSettings", "mRoster", "mTeam", "mMatchupScore"];

/**
 * Development override: ESPN_LEAGUE_FILE points at a saved league JSON (the same views),
 * so pages can be checked without ESPN cookies. Never set in production.
 */
async function leagueJson(
  scoringPeriodId: number,
): Promise<{ raw: unknown; teamId: number; season: number }> {
  const file = process.env.ESPN_LEAGUE_FILE;
  if (file) {
    return {
      raw: JSON.parse(await readFile(file, "utf8")),
      teamId: Number(process.env.ESPN_TEAM_ID),
      season: Number(process.env.ESPN_SEASON || 2027),
    };
  }
  const cfg = espnConfig();
  const raw = await fetchLeague(cfg, LEAGUE_VIEWS, { scoringPeriodId });
  return { raw, teamId: cfg.teamId, season: cfg.season };
}

export async function loadLeague(scoringPeriodId: number, ymd: string) {
  const { raw, teamId, season } = await leagueJson(scoringPeriodId);
  const yyyymmdd = ymd.replace(/-/g, "");
  const [games, scoreboard, injuries, lineups] = await Promise.all([
    nbaSchedule(season),
    fetchScoreboard(yyyymmdd).catch(() => []),
    safeInjuries(),
    // Published on game days only; any failure just means no lineup info yet.
    fetchDailyLineups(yyyymmdd).catch(() => null),
  ]);
  const settings = parseSettings(raw);
  const teams = parseTeams(raw);
  const me = teams.find((t) => t.id === teamId);
  if (!me) throw new Error(`team ${teamId} not found in the league`);
  return {
    settings,
    teams,
    me,
    matchups: parseMatchups(raw),
    games,
    scoreboard,
    injuries: injuries.list,
    lineups,
    warnings: injuries.error ? [`Injury feed unavailable: ${injuries.error}`] : [],
  };
}

/** Free agents and waiver players, most-owned first (empty in ESPN_LEAGUE_FILE dev mode). */
export async function loadFreeAgents(scoringPeriodId: number, limit = 250) {
  if (process.env.ESPN_LEAGUE_FILE) return [];
  const cfg = espnConfig();
  const raw = await fetchLeague(cfg, ["kona_player_info"], {
    filter: freeAgentFilter(limit),
    scoringPeriodId,
  });
  return parseFreeAgents(raw, cfg.season);
}
