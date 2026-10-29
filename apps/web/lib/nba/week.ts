// Matchup-week projection: for each remaining day, the best lineup each side can set
// given who has a game, then points so far + projected remaining and a rough win chance.

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { optimizeLineup, playProbability, type Position } from "@fantasy-copilot/fantasy-core";
import type { InjuryReport } from "@fantasy-copilot/nba-data";
import {
  gameEnvironment,
  matchupFactor,
  perGameProjection,
  type DefenseTable,
  type GameLine,
} from "./projection";

export interface TeamWeek {
  /** Per scoring period: ids projected to start (and with a game). */
  startsByDay: Map<number, Set<number>>;
  /** Per scoring period: the slot each projected starter fills. */
  slotsByDay: Map<number, Map<number, string>>;
  gamesByDay: Map<number, Set<number>>;
  projectedByDay: Map<number, number>;
  remaining: number;
}

export interface WeekInputs {
  periods: number[];
  /** First scoring period still to be projected (today). */
  fromPeriod: number;
  games: ProGame[];
  slotCounts: Record<string, number>;
  injuries: InjuryReport[];
  /** Today's points are partly banked; projected remaining for today comes from the day board. */
  todayRemaining?: number;
  /** First scoring period a player can be used (a pending waiver claim, or a game already tipped). */
  availableFrom?: Map<number, number>;
  /** Last scoring period a player can be used (dropped, but the drop takes effect tomorrow). */
  availableUntil?: Map<number, number>;
  /** Posted lines by game id (today's scoreboard): the game-environment factor where known. */
  lines?: Map<number, GameLine>;
  /**
   * Ruled-out players: the first day each can play again (ESPN's estimated return). Before it
   * he's out; from it on he's back, whatever today's status says.
   */
  outUntil?: Map<number, number>;
  /** Opponent defense by position (lib/nba/defense.ts). */
  defense?: DefenseTable | null;
}

/** Rest-of-week chance a listed player plays: today's status applies to the next two days; OUT holds all week. */
function playChance(status: string, daysAhead: number): number {
  const p = playProbability(status);
  if (p === 0) return 0;
  return daysAhead <= 1 ? p : 1;
}

export function projectTeamWeek(roster: RosterPlayer[], input: WeekInputs): TeamWeek {
  const injuries = new Map(input.injuries.map((i) => [i.playerId, i.status]));
  const startsByDay = new Map<number, Set<number>>();
  const slotsByDay = new Map<number, Map<number, string>>();
  const gamesByDay = new Map<number, Set<number>>();
  const projectedByDay = new Map<number, number>();
  const fppg = new Map(roster.map((p) => [p.id, perGameProjection(p, input.fromPeriod).fppg]));
  const chance = (p: RosterPlayer, sp: number, ahead: number) => {
    const back = input.outUntil?.get(p.id);
    if (back != null) return sp < back ? 0 : 1;
    return playChance(injuries.get(p.id) ?? p.injuryStatus ?? "ACTIVE", ahead);
  };
  let remaining = 0;
  for (const sp of input.periods) {
    const dayGames = input.games.filter((g) => g.scoringPeriodId === sp);
    const teams = new Set(dayGames.flatMap((g) => [g.homeProTeamId, g.awayProTeamId]));
    // Vegas game environment and the opponent's defense against his position.
    const env = (p: RosterPlayer) => {
      const g = dayGames.find(
        (x) => x.homeProTeamId === p.proTeamId || x.awayProTeamId === p.proTeamId,
      );
      if (!g) return 1;
      const home = g.homeProTeamId === p.proTeamId;
      return (
        gameEnvironment(input.lines?.get(g.gameId), home) *
        matchupFactor(input.defense, home ? g.awayProTeamId : g.homeProTeamId, p.positions)
      );
    };
    const playing = roster.filter((p) => teams.has(p.proTeamId));
    gamesByDay.set(sp, new Set(playing.map((p) => p.id)));
    if (sp < input.fromPeriod) continue;
    const ahead = sp - input.fromPeriod;
    const players = roster.map((p) => ({
      id: p.id,
      eligible: p.positions as Position[],
      value:
        teams.has(p.proTeamId) &&
        (input.availableFrom?.get(p.id) ?? 0) <= sp &&
        sp <= (input.availableUntil?.get(p.id) ?? Infinity)
          ? chance(p, sp, ahead) * (fppg.get(p.id) ?? 0) * env(p)
          : 0,
      currentSlot: "BE",
    }));
    const best = optimizeLineup(players, input.slotCounts);
    const starts = new Set(
      players
        .filter(
          (x) => x.value > 0 && best.slotOf.get(x.id) !== "BE" && best.slotOf.get(x.id) !== "IR",
        )
        .map((x) => x.id),
    );
    startsByDay.set(sp, starts);
    slotsByDay.set(sp, new Map([...starts].map((id) => [id, best.slotOf.get(id)!])));
    const pts =
      sp === input.fromPeriod && input.todayRemaining != null ? input.todayRemaining : best.points;
    projectedByDay.set(sp, pts);
    remaining += pts;
  }
  return { startsByDay, slotsByDay, gamesByDay, projectedByDay, remaining };
}

// Weekly score spread calibrated on 2025-26 (CV ~0.13 for active managers), applied to
// the part of the week still to be played.
const REMAINING_CV = 0.14;

/** P(my final > opponent's final) under a normal approximation. */
export function winProbability(
  myBanked: number,
  myRemaining: number,
  oppBanked: number,
  oppRemaining: number,
): number {
  const diff = myBanked + myRemaining - (oppBanked + oppRemaining);
  const sd = Math.hypot(REMAINING_CV * myRemaining, REMAINING_CV * oppRemaining);
  if (sd === 0) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  return normalCdf(diff / sd);
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * A win chance for display: never 100% or 0% while points are still to come (the model can't
 * rule out a big night or a late scratch), only once nothing is left to play.
 */
export function winChanceLabel(p: number, decided: boolean): string {
  if (decided) return `${Math.round(p * 100)}%`;
  if (p >= 0.995) return ">99%";
  if (p <= 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}
