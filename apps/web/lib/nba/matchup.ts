// This week's head-to-head: banked points, projected remaining for both sides, win chance.
// Shared by /nba/week and /nba/waivers so both use the same baseline.

import type { FantasyTeam } from "@fantasy-copilot/espn";
import { matchupPeriodOf, scoringPeriodsOf } from "./calendar";
import type { loadLeague } from "./data";
import { buildDayBoard, type DayRow } from "./day";
import { gameElapsed, isStarting } from "./live";
import { projectTeamWeek, winProbability, type TeamWeek, type WeekInputs } from "./week";

type LeagueData = Awaited<ReturnType<typeof loadLeague>>;

export interface MatchupView {
  mp: number;
  periods: number[];
  opp: FantasyTeam | undefined;
  /** Points so far this week, including games in progress (ESPN live totals). */
  myBanked: number;
  oppBanked: number;
  /** Today's day boards (each side's roster against today's games). */
  myToday: DayRow[];
  oppToday: DayRow[] | null;
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
  const myBanked = matchup ? (iAmHome ? matchup.homeLive : (matchup.awayLive ?? 0)) : 0;
  const oppBanked = matchup ? (iAmHome ? (matchup.awayLive ?? 0) : matchup.homeLive) : 0;

  const todayGames = data.games.filter((g) => g.scoringPeriodId === sp);
  const scoreboard = new Map(data.scoreboard.map((g) => [g.gameId, g]));
  const boardOf = (team: FantasyTeam) =>
    buildDayBoard({
      roster: team.roster,
      slotCounts: data.settings.slotCounts,
      games: todayGames,
      scoreboard: data.scoreboard,
      injuries: data.injuries,
      lineups: data.lineups,
    }).rows;
  const myToday = boardOf(data.me);
  const oppToday = opp ? boardOf(opp) : null;
  // Today's remaining = best lineup among players whose games haven't started, plus the rest
  // of the games in progress for players starting in them (banked points cover the part played).
  const remainingToday = (rows: DayRow[]) =>
    rows.reduce((a, r) => {
      if (!r.locked) return a + (isStarting(r.recommendedSlot) ? r.value : 0);
      const g = r.game && scoreboard.get(r.game.gameId);
      return g && g.state === "in" && isStarting(r.currentSlot)
        ? a + r.value * (1 - gameElapsed(g))
        : a;
    }, 0);
  const weekInputs: WeekInputs = {
    periods,
    fromPeriod: sp,
    games: data.games,
    slotCounts: data.settings.slotCounts,
    injuries: data.injuries,
  };
  const mine = projectTeamWeek(data.me.roster, {
    ...weekInputs,
    todayRemaining: remainingToday(myToday),
  });
  const theirs = opp
    ? projectTeamWeek(opp.roster, { ...weekInputs, todayRemaining: remainingToday(oppToday!) })
    : null;
  const pWin = theirs
    ? winProbability(myBanked, mine.remaining, oppBanked, theirs.remaining)
    : null;
  return {
    mp,
    periods,
    opp,
    myBanked,
    oppBanked,
    myToday,
    oppToday,
    weekInputs,
    mine,
    theirs,
    pWin,
  };
}
