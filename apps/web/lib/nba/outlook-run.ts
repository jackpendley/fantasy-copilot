import "server-only";
// Run the season outlook against the live league and store it in outlook_runs.

import {
  fetchLeague,
  freeAgentFilter,
  parsePlayerPool,
  parseTeams,
  type FantasyTeam,
} from "@fantasy-copilot/espn";
import { simulateSeasonAsync } from "@fantasy-copilot/fantasy-core";
import { db } from "../db";
import { espnConfig } from "../env";
import { LAST_SCORING_PERIOD, etDate, matchupPeriodOf, scoringPeriodForDate } from "./calendar";
import { loadLeague } from "./data";
import { weekPointsThroughToday } from "./matchup";
import { buildOutlookInput } from "./outlook";
import { dayStarted } from "./roster";
import { applyTrade, marginalValues, valueContext } from "./trade";

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

/**
 * Everything a season simulation starts from. Before today's first tip it starts today. Once a
 * game has tipped it starts tomorrow: today's points (live, plus the expected rest of the day)
 * are banked, and every team plays tomorrow's roster, so moves made after the lock count.
 */
export async function outlookSetup(now = new Date()) {
  const date = etDate(now);
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
  return {
    data: { ...league, teams: league.ahead.teams, me: league.ahead.me },
    previousTeams,
    freeAgents: parsePlayerPool(faRaw, cfg.season),
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
  const { data, previousTeams, freeAgents, fromDay, bankedNow } = await outlookSetup(readAt);
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
    seasons,
  });
  // Runs in slices so the server keeps serving pages while it simulates.
  const results = await simulateSeasonAsync(input);
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
    insert into outlook_runs (run_at, scoring_period, seasons, results, trigger)
    values (${readAt}, ${fromDay}, ${seasons}, ${db().json(teams as never)}, ${trigger})
  `;
  return { scoringPeriod: fromDay, teams };
}

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
    from outlook_runs order by run_at desc limit 2
  `;
}

export async function latestOutlook() {
  const rows = await db()<OutlookRun[]>`
    select run_at, scoring_period, seasons, results, trigger
    from outlook_runs order by run_at desc limit 1
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

/**
 * A trade's effect on playoff and title odds: the season simulated with and without it, same
 * seed and the same number of seasons, so most of the noise cancels.
 */
export async function simulateTrade(
  partnerId: number,
  giveIds: number[],
  getIds: number[],
  seasons = 500,
) {
  const { data, previousTeams, freeAgents, fromDay, bankedNow } = await outlookSetup();
  const partner = data.teams.find((t) => t.id === partnerId);
  if (!partner) throw new Error("unknown team");
  const give = data.me.roster.filter((p) => giveIds.includes(p.id));
  const get = partner.roster.filter((p) => getIds.includes(p.id));
  if (give.length !== giveIds.length || get.length !== getIds.length) {
    throw new Error("a player in this trade is no longer on that roster");
  }
  // Same roster balancing as the trade evaluation: uneven trades drop or add players.
  const ctx = valueContext(
    data.games,
    data.settings.slotCounts,
    fromDay,
    LAST_SCORING_PERIOD,
    data.settings.regularSeasonWeeks,
  );
  const taken = new Set<number>();
  const mine = applyTrade(
    data.me.roster,
    give,
    get,
    ctx,
    freeAgents,
    taken,
    marginalValues(data.me.roster, ctx),
  );
  const theirs = applyTrade(
    partner.roster,
    get,
    give,
    ctx,
    freeAgents,
    taken,
    marginalValues(partner.roster, ctx),
  );
  const traded = data.teams.map((t) =>
    t.id === data.me.id
      ? { ...t, roster: mine.roster }
      : t.id === partnerId
        ? { ...t, roster: theirs.roster }
        : t,
  );
  const run = (teams: FantasyTeam[]) =>
    simulateSeasonAsync(
      buildOutlookInput({
        teams,
        previousTeams,
        freeAgents: freeAgents.filter((f) => !taken.has(f.id)),
        games: data.games,
        matchups: data.matchups,
        slotCounts: data.settings.slotCounts,
        addCapPerWeek: data.settings.addsPerWeek ?? 3,
        regularWeeks: data.settings.regularSeasonWeeks,
        fromDay,
        bankedNow,
        seasons,
      }).input,
    );
  const before = await run(data.teams);
  const after = await run(traded);
  const pick = (rs: typeof before, id: number) => {
    const r = rs.find((x) => x.teamId === id)!;
    return { playoffs: r.playoffs, champ: r.champ, expWins: r.expWins };
  };
  return {
    seasons,
    mine: { before: pick(before, data.me.id), after: pick(after, data.me.id) },
    theirs: { before: pick(before, partnerId), after: pick(after, partnerId) },
  };
}
