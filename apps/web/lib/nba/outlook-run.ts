import "server-only";
// Run the season outlook against the live league and store it in outlook_runs.

import {
  fetchLeague,
  freeAgentFilter,
  parsePlayerPool,
  parseTeams,
  type FantasyTeam,
} from "@fantasy-copilot/espn";
import { simulateSeasonAsync, type SimTeamResult } from "@fantasy-copilot/fantasy-core";
import { db } from "../db";
import { espnConfig } from "../env";
import { LAST_SCORING_PERIOD, matchupPeriodOf, scoringPeriodForDate, gameDate } from "./calendar";
import { loadLeague } from "./data";
import { weekPointsThroughToday } from "./matchup";
import { buildOutlookInput } from "./outlook";
import { absences } from "./availability";
import { dayStarted } from "./roster";

export interface OutlookTeam {
  teamId: number;
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  expWins: number;
  playoffs: number;
  seed1: number;
  /** A first-round bye (top-2 seed); missing on runs from before byes were counted. */
  bye?: number;
  final: number;
  champ: number;
  /** Title and a bye together; missing on older runs. */
  champBye?: number;
  act: number;
  addsPerWeek: number;
}

// Last season's activity changes once a year: keep it in memory.
let previousCache: FantasyTeam[] | null = null;
async function previousSeasonTeams(): Promise<FantasyTeam[] | null> {
  if (previousCache) return previousCache;
  const cfg = espnConfig();
  try {
    const raw = await fetchLeague({ ...cfg, season: cfg.season - 1 }, ["mTeam"]);
    previousCache = parseTeams(raw);
    return previousCache;
  } catch {
    return null; // new league or not visible: every manager gets the default prior
  }
}

/**
 * Everything a season simulation starts from. Before today's first tip it starts today. Once a
 * game has tipped it starts tomorrow: today's points (live, plus the expected rest of the day)
 * are banked, and every team plays tomorrow's roster, so moves made after the lock count.
 */
export async function outlookSetup(now = new Date()) {
  const date = gameDate(now);
  const today = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const cfg = espnConfig();
  const [league, previousTeams, faRaw] = await Promise.all([
    loadLeague(today, date),
    previousSeasonTeams(),
    fetchLeague(cfg, ["kona_player_info"], {
      filter: freeAgentFilter(150),
      scoringPeriodId: today,
    }),
  ]);
  const tips = league.games.filter((g) => g.scoringPeriodId === today).map((g) => g.date);
  const midDay = today < LAST_SCORING_PERIOD && dayStarted(tips, league.scoreboard, now);
  const freeAgents = parsePlayerPool(faRaw, cfg.season);
  return {
    /** When the rosters were read (a run is stamped with it). */
    readAt: now,
    data: { ...league, teams: league.ahead.teams, me: league.ahead.me },
    previousTeams,
    freeAgents,
    // Known injuries, from ESPN's estimated return dates.
    injured: absences(
      [...league.ahead.teams.flatMap((t) => t.roster), ...freeAgents],
      league.injuries,
      today,
    ),
    fromDay: midDay ? today + 1 : today,
    bankedNow: midDay
      ? { period: matchupPeriodOf(today), points: weekPointsThroughToday(league, today) }
      : undefined,
  };
}

/** `trigger`: what set off this run ("Team 7 added Player X"); null for the nightly run. */
export async function runOutlook(
  seasons = 2000,
  trigger: string | null = null,
): Promise<{ scoringPeriod: number; teams: OutlookTeam[] }> {
  // Stamped with when its data was read, so a move made while it simulates still counts as newer.
  const readAt = new Date();
  const { data, previousTeams, freeAgents, fromDay, bankedNow, injured } =
    await outlookSetup(readAt);
  const { input, activity } = buildOutlookInput({
    teams: data.teams,
    previousTeams,
    freeAgents,
    games: data.games,
    matchups: data.matchups,
    slotCounts: data.settings.slotCounts,
    addCapPerWeek: data.settings.addsPerWeek ?? 3,
    regularWeeks: data.settings.regularSeasonWeeks,
    fromDay,
    bankedNow,
    injured,
    seasons,
  });
  const byId = new Map(data.teams.map((t) => [t.id, t]));
  const describe = (results: SimTeamResult[]): OutlookTeam[] =>
    results
      .map((r) => {
        const t = byId.get(r.teamId)!;
        const a = activity.get(r.teamId)!;
        return {
          ...r,
          name: t.name,
          wins: t.wins,
          losses: t.losses,
          pointsFor: t.pointsFor,
          act: a.act,
          addsPerWeek: a.addsPerWeek,
        };
      })
      .sort((x, y) => y.champ - x.champ);
  // The run's row exists from the start and shows the odds so far (a provisional preview).
  const [row] = await db()<{ id: number }[]>`
    insert into outlook_runs (run_at, scoring_period, seasons, results, trigger, status, updated_at)
    values (${readAt}, ${fromDay}, 0, '[]'::jsonb, ${trigger}, 'running', now())
    returning id
  `;
  const id = row!.id;
  let teams: OutlookTeam[];
  const cpu0 = process.cpuUsage();
  try {
    // Runs in slices so the server keeps serving pages while it simulates.
    const results = await simulateSeasonAsync(input, 25, {
      every: PROGRESS_EVERY,
      report: async (partial, done) => {
        await db()`
          update outlook_runs set seasons = ${done}, results = ${db().json(describe(partial) as never)},
            updated_at = now()
          where id = ${id}
        `;
      },
    });
    teams = describe(results);
    await db()`
      update outlook_runs set seasons = ${seasons}, results = ${db().json(teams as never)},
        status = 'final', updated_at = now()
      where id = ${id}
    `;
    await logCpu("outlook-sim", cpu0, { seasons });
  } catch (e) {
    await db()`delete from outlook_runs where id = ${id}`.catch(() => {});
    throw e;
  }
  return { scoringPeriod: fromDay, teams };
}

/** A simulation's CPU seconds, for the month's total on Settings (Vercel Hobby: 4 CPU-hours). */
async function logCpu(job: string, since: NodeJS.CpuUsage, extra: Record<string, unknown>) {
  const used = process.cpuUsage(since);
  const cpu = Math.round((used.user + used.system) / 1e5) / 10;
  const detail = JSON.stringify({ cpu, ...extra });
  await db()`insert into refresh_log (job, status, detail) values (${job}, 'ok', ${detail})`.catch(
    () => {},
  );
}

/** A running outlook reports its odds so far this often (seasons). */
const PROGRESS_EVERY = 250;

export interface OutlookRun {
  run_at: Date;
  scoring_period: number;
  seasons: number;
  results: OutlookTeam[];
  /** What set the run off (a roster move), or null for the nightly and manual runs. */
  trigger: string | null;
}

/** The latest run and the one before it (for "change since last update"). */
export async function latestOutlooks() {
  return db()<OutlookRun[]>`
    select run_at, scoring_period, seasons, results, trigger
    from outlook_runs where status = 'final' order by run_at desc limit 2
  `;
}

export async function latestOutlook() {
  const rows = await db()<OutlookRun[]>`
    select run_at, scoring_period, seasons, results, trigger
    from outlook_runs where status = 'final' order by run_at desc limit 1
  `;
  return rows[0] ?? null;
}

/**
 * The run in progress, once it has odds to show: newer than the latest final run and still
 * reporting (a crashed run stops updating and drops out after a few minutes).
 */
export async function provisionalOutlook(): Promise<OutlookRun | null> {
  const rows = await db()<OutlookRun[]>`
    select run_at, scoring_period, seasons, results, trigger from outlook_runs r
    where status = 'running' and seasons > 0 and updated_at > now() - interval '3 minutes'
      and run_at > coalesce((select max(run_at) from outlook_runs where status = 'final'), '-infinity')
    order by run_at desc limit 1
  `;
  return rows[0] ?? null;
}

/** One point per run for a team: date and its odds. */
export async function outlookHistory(teamId: number) {
  const rows = await db()<{ run_at: Date; t: OutlookTeam | null }[]>`
    select run_at,
      (select r from jsonb_array_elements(results) r where (r->>'teamId')::int = ${teamId}) as t
    from outlook_runs where status = 'final' order by run_at asc
  `;
  return rows
    .filter((r) => r.t)
    .map((r) => ({
      at: r.run_at.toISOString(),
      playoffs: r.t!.playoffs,
      seed1: r.t!.seed1,
      champ: r.t!.champ,
      expWins: r.t!.expWins,
    }));
}
