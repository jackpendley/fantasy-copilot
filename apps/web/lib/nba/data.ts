import "server-only";
// Live loaders. Pages read ESPN and the NBA feeds directly (a handful of parallel requests,
// ~100-300 ms each), so the app works as soon as the ESPN cookies are set. The database
// comes in with history-dependent features (alerts, news latency, ML). Responses are reused
// for a few seconds (memoFetch) so moving between pages doesn't repeat them; ESPN writes
// clear them.

import {
  fetchLeague,
  fetchProSchedule,
  freeAgentFilter,
  parseDraftPicks,
  parseFreeAgents,
  parseLiveRosters,
  parseMatchups,
  parseProSchedule,
  parseSettings,
  parseTeams,
  type ProGame,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import {
  fetchDailyLineups,
  fetchInjuries,
  fetchScoreboard,
  type InjuryReport,
} from "@fantasy-copilot/nba-data";
import { readFile } from "node:fs/promises";
import { espnConfig } from "../env";
import { memoFetch } from "../fetch-memo";
import { LAST_SCORING_PERIOD } from "./calendar";
import { defenseTable } from "./defense-table";

/** How long each read is reused: rosters and matchups, live scores, slower feeds. */
const LEAGUE_FETCH = memoFetch(20_000);
const LIVE_FETCH = memoFetch(15_000);
const FEED_FETCH = memoFetch(60_000);
const LINEUPS_FETCH = memoFetch(5 * 60_000);

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
    return { list: await fetchInjuries(FEED_FETCH), error: null };
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
  const raw = await fetchLeague(cfg, LEAGUE_VIEWS, { scoringPeriodId, fetchImpl: LEAGUE_FETCH });
  return { raw, teamId: cfg.teamId, season: cfg.season };
}

/**
 * Every team's roster for tomorrow, as ESPN has it. A move made after today's roster lock (the
 * first tip) only shows up here. Null on the last day and in ESPN_LEAGUE_FILE dev mode.
 */
async function rostersAhead(scoringPeriodId: number): Promise<Map<number, RosterPlayer[]> | null> {
  if (process.env.ESPN_LEAGUE_FILE || scoringPeriodId >= LAST_SCORING_PERIOD) return null;
  const raw = await fetchLeague(espnConfig(), ["mRoster"], {
    scoringPeriodId: scoringPeriodId + 1,
    fetchImpl: LEAGUE_FETCH,
  });
  return new Map(parseTeams(raw).map((t) => [t.id, t.roster]));
}

export async function loadLeague(scoringPeriodId: number, ymd: string) {
  const yyyymmdd = ymd.replace(/-/g, "");
  const [{ raw, teamId, season }, ahead] = await Promise.all([
    leagueJson(scoringPeriodId),
    rostersAhead(scoringPeriodId),
  ]);
  const [games, scoreboard, injuries, lineups, defense] = await Promise.all([
    nbaSchedule(season),
    fetchScoreboard(yyyymmdd, LIVE_FETCH).catch(() => []),
    safeInjuries(),
    // Published on game days only; any failure just means no lineup info yet.
    fetchDailyLineups(yyyymmdd, LINEUPS_FETCH).catch(() => null),
    defenseTable().catch(() => null),
  ]);
  const settings = parseSettings(raw);
  const teams = parseTeams(raw);
  const me = teams.find((t) => t.id === teamId);
  if (!me) throw new Error(`team ${teamId} not found in the league`);
  const teamsAhead = teams.map((t) => ({ ...t, roster: ahead?.get(t.id) ?? t.roster }));
  return {
    settings,
    /** Today's rosters: who scores today. */
    teams,
    me,
    /** Tomorrow's rosters (moves made after today's lock): who scores from tomorrow on. */
    ahead: { teams: teamsAhead, me: teamsAhead.find((t) => t.id === teamId)! },
    matchups: parseMatchups(raw),
    games,
    scoreboard,
    injuries: injuries.list,
    lineups,
    /** Opponent defense by position (null before the first nightly run). */
    defense,
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
    fetchImpl: FEED_FETCH,
  });
  return parseFreeAgents(raw, cfg.season);
}

/** Today's fantasy points per player for every team in this matchup period (live during games). */
export async function loadLiveRosters(scoringPeriodId: number, matchupPeriod: number) {
  if (process.env.ESPN_LEAGUE_FILE) return new Map<number, never[]>();
  const cfg = espnConfig();
  const raw = await fetchLeague(cfg, ["mMatchupScore", "mBoxscore"], {
    filter: { schedule: { filterMatchupPeriodIds: { value: [matchupPeriod] } } },
    scoringPeriodId,
    fetchImpl: LIVE_FETCH,
  });
  return parseLiveRosters(raw, matchupPeriod);
}

// The draft doesn't change: keep it for the life of the server instance.
let draftCache: Map<number, number> | null = null;

/** Overall pick per drafted player in this league (empty in ESPN_LEAGUE_FILE dev mode). */
export async function loadDraftPicks(): Promise<Map<number, number>> {
  if (process.env.ESPN_LEAGUE_FILE) return new Map();
  if (draftCache) return draftCache;
  draftCache = parseDraftPicks(await fetchLeague(espnConfig(), ["mDraftDetail"]));
  return draftCache;
}
