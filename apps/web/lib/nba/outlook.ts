// Season outlook: turn live league data into a season simulation (packages/fantasy-core sim)
// and summarize each team's odds. Pure builders here; lib/nba/outlook-run.ts does the IO.

import type { FantasyTeam, Matchup, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import type { Position, SimInput, SimPlayer, SimTeam } from "@fantasy-copilot/fantasy-core";
import { LAST_SCORING_PERIOD, matchupPeriodOf } from "./calendar";
import { perGameProjection } from "./projection";

/** A daily manager makes ~2.5 lineup moves per day (2025-26: ~400 over the season). */
const MOVES_PER_ACTIVE_DAY = 2.5;
const PRIOR_SEASON_DAYS = 160;
const PRIOR_SEASON_WEEKS = 22;
/** Days of this season's data that weigh as much as the prior. */
const PRIOR_DAYS = 21;
/** For new owners (no history): moderately active. */
const DEFAULT_PRIOR = { act: 0.7, addsPerWeek: 0.6 };

export interface Activity {
  act: number;
  addsPerWeek: number;
}

type Counts = { lineupMoves: number; adds: number } | null;

export function managerActivity(current: Counts, prior: Counts, daysPlayed: number): Activity {
  const p = prior
    ? {
        act: Math.min(1, prior.lineupMoves / (MOVES_PER_ACTIVE_DAY * PRIOR_SEASON_DAYS)),
        addsPerWeek: prior.adds / PRIOR_SEASON_WEEKS,
      }
    : DEFAULT_PRIOR;
  if (!current || daysPlayed <= 0) return p;
  const now = {
    act: Math.min(1, current.lineupMoves / (MOVES_PER_ACTIVE_DAY * daysPlayed)),
    addsPerWeek: current.adds / (daysPlayed / 7),
  };
  const w = daysPlayed / (daysPlayed + PRIOR_DAYS);
  return {
    act: w * now.act + (1 - w) * p.act,
    addsPerWeek: w * now.addsPerWeek + (1 - w) * p.addsPerWeek,
  };
}

export function toSimPlayer(p: RosterPlayer): SimPlayer {
  const proj = perGameProjection(p);
  const projectedGames =
    p.projection?.avg && p.projection.total ? p.projection.total / p.projection.avg : 70;
  return {
    id: p.id,
    eligible: p.positions as Position[],
    proTeamId: p.proTeamId,
    fppg: proj.fppg,
    gp: Math.min(82, projectedGames),
    // Projection error shrinks as real games accumulate.
    sd: 0.13 * Math.sqrt(15 / (15 + proj.gamesPlayed)),
  };
}

export interface OutlookArgs {
  teams: FantasyTeam[];
  /** Last season's teams (same league), to seed manager activity; null if unavailable. */
  previousTeams: FantasyTeam[] | null;
  freeAgents: RosterPlayer[];
  games: ProGame[];
  matchups: Matchup[];
  slotCounts: Record<string, number>;
  addCapPerWeek: number;
  regularWeeks: number;
  /** First scoring period still to be played (today, when run before the day's games). */
  fromDay: number;
  seasons: number;
  seed?: number;
}

export function buildOutlookInput(a: OutlookArgs): {
  input: SimInput;
  activity: Map<number, Activity>;
} {
  const currentPeriod = matchupPeriodOf(a.fromDay);
  const previous = new Map((a.previousTeams ?? []).map((t) => [t.id, t]));
  const activity = new Map<number, Activity>();
  const teams: SimTeam[] = a.teams.map((t) => {
    const prev = previous.get(t.id);
    const sameOwner = prev && prev.ownerId && prev.ownerId === t.ownerId ? prev.activity : null;
    const act = managerActivity(t.activity, sameOwner, a.fromDay - 1);
    activity.set(t.id, act);
    return { id: t.id, roster: t.roster.map(toSimPlayer), ...act };
  });

  const gameDays = new Map<number, Set<number>>();
  for (const g of a.games) {
    for (const pro of [g.homeProTeamId, g.awayProTeamId]) {
      if (!gameDays.has(pro)) gameDays.set(pro, new Set());
      gameDays.get(pro)!.add(g.scoringPeriodId);
    }
  }

  const banked = new Map<number, Map<number, number>>();
  const bank = (team: number, period: number, pts: number) => {
    if (!banked.has(team)) banked.set(team, new Map());
    banked.get(team)!.set(period, pts);
  };
  const matchups: SimInput["matchups"] = [];
  for (const m of a.matchups) {
    if (m.awayTeamId == null || m.period > a.regularWeeks) continue;
    if (m.period <= currentPeriod) {
      bank(m.homeTeamId, m.period, m.homePoints);
      bank(m.awayTeamId, m.period, m.awayPoints ?? 0);
    }
    const decided = m.period < currentPeriod && ["HOME", "AWAY", "TIE"].includes(m.winner);
    matchups.push({
      period: m.period,
      home: m.homeTeamId,
      away: m.awayTeamId,
      winner: decided ? (m.winner as "HOME" | "AWAY" | "TIE") : null,
    });
  }

  const freeAgents = a.freeAgents
    .map(toSimPlayer)
    .filter((p) => p.gp >= 35 && p.fppg > 0)
    .sort((x, y) => y.fppg - x.fppg)
    .slice(0, 80);

  return {
    activity,
    input: {
      teams,
      freeAgents,
      slotCounts: a.slotCounts,
      gameDays,
      periodOf: matchupPeriodOf,
      fromDay: a.fromDay,
      lastDay: LAST_SCORING_PERIOD,
      matchups,
      regularWeeks: a.regularWeeks,
      banked,
      playoffWeeks: [a.regularWeeks + 1, a.regularWeeks + 2, a.regularWeeks + 3],
      addCapPerWeek: a.addCapPerWeek,
      seasons: a.seasons,
      seed: a.seed,
    },
  };
}
