import "server-only";
// Run the season outlook against the live league and store it in outlook_runs.

import {
  fetchLeague,
  freeAgentFilter,
  parsePlayerPool,
  parseTeams,
  type FantasyTeam,
} from "@fantasy-copilot/espn";
import { simulateSeason } from "@fantasy-copilot/fantasy-core";
import { db } from "../db";
import { espnConfig } from "../env";
import { LAST_SCORING_PERIOD, etDate, scoringPeriodForDate } from "./calendar";
import { loadLeague } from "./data";
import { buildOutlookInput } from "./outlook";

export interface OutlookTeam {
  teamId: number;
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  expWins: number;
  playoffs: number;
  seed1: number;
  final: number;
  champ: number;
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

export async function runOutlook(
  seasons = 800,
): Promise<{ scoringPeriod: number; teams: OutlookTeam[] }> {
  const date = etDate();
  const fromDay = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const cfg = espnConfig();
  const [data, previousTeams, faRaw] = await Promise.all([
    loadLeague(fromDay, date),
    previousSeasonTeams(),
    fetchLeague(cfg, ["kona_player_info"], {
      filter: freeAgentFilter(150),
      scoringPeriodId: fromDay,
    }),
  ]);
  const { input, activity } = buildOutlookInput({
    teams: data.teams,
    previousTeams,
    freeAgents: parsePlayerPool(faRaw, cfg.season),
    games: data.games,
    matchups: data.matchups,
    slotCounts: data.settings.slotCounts,
    addCapPerWeek: data.settings.addsPerWeek ?? 3,
    regularWeeks: data.settings.regularSeasonWeeks,
    fromDay,
    seasons,
  });
  const results = simulateSeason(input);
  const byId = new Map(data.teams.map((t) => [t.id, t]));
  const teams: OutlookTeam[] = results
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
  await db()`
    insert into outlook_runs (scoring_period, seasons, results)
    values (${fromDay}, ${seasons}, ${db().json(teams as never)})
  `;
  return { scoringPeriod: fromDay, teams };
}

/** The latest run and the one before it (for "change since last update"). */
export async function latestOutlooks() {
  return db()<{ run_at: Date; scoring_period: number; seasons: number; results: OutlookTeam[] }[]>`
    select run_at, scoring_period, seasons, results from outlook_runs order by run_at desc limit 2
  `;
}

export async function latestOutlook() {
  const rows = await db()<
    { run_at: Date; scoring_period: number; seasons: number; results: OutlookTeam[] }[]
  >`
    select run_at, scoring_period, seasons, results from outlook_runs order by run_at desc limit 1
  `;
  return rows[0] ?? null;
}

/** One point per run for a team: date and its odds. */
export async function outlookHistory(teamId: number) {
  const rows = await db()<{ run_at: Date; t: OutlookTeam | null }[]>`
    select run_at,
      (select r from jsonb_array_elements(results) r where (r->>'teamId')::int = ${teamId}) as t
    from outlook_runs order by run_at asc
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
