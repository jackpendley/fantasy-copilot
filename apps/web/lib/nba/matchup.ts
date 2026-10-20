// This week's head-to-head: banked points, projected remaining for both sides, win chance.
// Shared by /nba/week and /nba/waivers so both use the same baseline.

import type { FantasyTeam } from "@fantasy-copilot/espn";
import { matchupPeriodOf, scoringPeriodsOf } from "./calendar";
import type { loadLeague } from "./data";
import { buildDayBoard } from "./day";
import { projectTeamWeek, winProbability, type TeamWeek, type WeekInputs } from "./week";

type LeagueData = Awaited<ReturnType<typeof loadLeague>>;

export interface MatchupView {
  mp: number;
  periods: number[];
  opp: FantasyTeam | undefined;
  myBanked: number;
  oppBanked: number;
  /** Inputs for projectTeamWeek (from today), reusable for what-if rosters. */
  weekInputs: WeekInputs;
  mine: TeamWeek;
  theirs: TeamWeek | null;
  pWin: number | null;
}

export function matchupView(data: LeagueData, sp: number): MatchupView {
  const mp = matchupPeriodOf(sp);
  const periods = scoringPeriodsOf(mp);
  const matchup = data.matchups.find(
    (m) => m.period === mp && (m.homeTeamId === data.me.id || m.awayTeamId === data.me.id),
  );
  const iAmHome = matchup?.homeTeamId === data.me.id;
  const oppId = matchup ? (iAmHome ? matchup.awayTeamId : matchup.homeTeamId) : null;
  const opp = data.teams.find((t) => t.id === oppId);
  const myBanked = matchup ? (iAmHome ? matchup.homePoints : (matchup.awayPoints ?? 0)) : 0;
  const oppBanked = matchup ? (iAmHome ? (matchup.awayPoints ?? 0) : matchup.homePoints) : 0;

  const todayGames = data.games.filter((g) => g.scoringPeriodId === sp);
  // Today's remaining = best lineup among players whose games haven't started.
  const remainingToday = (team: FantasyTeam) => {
    const board = buildDayBoard({
      roster: team.roster,
      slotCounts: data.settings.slotCounts,
      games: todayGames,
      scoreboard: data.scoreboard,
      injuries: data.injuries,
      lineups: data.lineups,
    });
    return board.rows
      .filter((r) => !r.locked && r.recommendedSlot !== "BE" && r.recommendedSlot !== "IR")
      .reduce((a, r) => a + r.value, 0);
  };
  const weekInputs: WeekInputs = {
    periods,
    fromPeriod: sp,
    games: data.games,
    slotCounts: data.settings.slotCounts,
    injuries: data.injuries,
  };
  const mine = projectTeamWeek(data.me.roster, {
    ...weekInputs,
    todayRemaining: remainingToday(data.me),
  });
  const theirs = opp
    ? projectTeamWeek(opp.roster, { ...weekInputs, todayRemaining: remainingToday(opp) })
    : null;
  const pWin = theirs
    ? winProbability(myBanked, mine.remaining, oppBanked, theirs.remaining)
    : null;
  return { mp, periods, opp, myBanked, oppBanked, weekInputs, mine, theirs, pWin };
}
