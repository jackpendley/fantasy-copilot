// This week's head-to-head: banked points, projected remaining for both sides, win chance.
// Shared by /nba/week and /nba/waivers so both use the same baseline.

import type { FantasyTeam } from "@fantasy-copilot/espn";
import type { ScoreboardGame } from "@fantasy-copilot/nba-data";
import { matchupPeriodOf, scoringPeriodsOf } from "./calendar";
import type { loadLeague } from "./data";
import { buildDayBoard, type DayRow } from "./day";
import { absences } from "./availability";
import { gameElapsed, isStarting } from "./live";
import { pendingMoves, weekRoster, type PendingMoves } from "./roster";
import { projectTeamWeek, winProbability, type TeamWeek, type WeekInputs } from "./week";

type LeagueData = Awaited<ReturnType<typeof loadLeague>>;

export interface MatchupView {
  mp: number;
  periods: number[];
  opp: FantasyTeam | undefined;
  /** Each side's roster changes that take effect tomorrow. */
  myPending: PendingMoves;
  oppPending: PendingMoves | null;
  /** Points so far this week, including games in progress (ESPN live totals). */
  myBanked: number;
  oppBanked: number;
  /** Today's day boards (each side's roster against today's games). */
  myToday: DayRow[];
  oppToday: DayRow[] | null;
  /**
   * Inputs for projectTeamWeek (from today), reusable for what-if rosters. Its availability
   * windows cover both teams' pending moves; `myWeekRoster` is the roster they apply to.
   */
  weekInputs: WeekInputs;
  myWeekRoster: FantasyTeam["roster"];
  mine: TeamWeek;
  theirs: TeamWeek | null;
  pWin: number | null;
}

/** `perGame`: today's projections to use instead of our model's (the props blend, lib/nba/best.ts). */
export function matchupView(
  data: LeagueData,
  sp: number,
  perGame?: Map<number, number>,
): MatchupView {
  const mp = matchupPeriodOf(sp);
  const periods = scoringPeriodsOf(mp);
  const matchup = data.matchups.find(
    (m) => m.period === mp && (m.homeTeamId === data.me.id || m.awayTeamId === data.me.id),
  );
  const iAmHome = matchup?.homeTeamId === data.me.id;
  const oppId = matchup ? (iAmHome ? matchup.awayTeamId : matchup.homeTeamId) : null;
  const opp = data.teams.find((t) => t.id === oppId);
  const oppAhead = data.ahead.teams.find((t) => t.id === oppId);
  const myBanked = matchup ? (iAmHome ? matchup.homeLive : (matchup.awayLive ?? 0)) : 0;
  const oppBanked = matchup ? (iAmHome ? (matchup.awayLive ?? 0) : matchup.homeLive) : 0;

  const todayGames = data.games.filter((g) => g.scoringPeriodId === sp);
  const scoreboard = new Map(data.scoreboard.map((g) => [g.gameId, g]));
  const boardOf = (team: FantasyTeam) =>
    buildDayBoard({
      defense: data.defense,
      roster: team.roster,
      slotCounts: data.settings.slotCounts,
      games: todayGames,
      scoreboard: data.scoreboard,
      injuries: data.injuries,
      lineups: data.lineups,
      perGame,
    }).rows;
  const myToday = boardOf(data.me);
  const oppToday = opp ? boardOf(opp) : null;
  // From tomorrow on, each side plays tomorrow's roster (moves made after today's lock).
  const myWeek = weekRoster(data.me.roster, data.ahead.me.roster, sp);
  const oppWeek = opp && oppAhead ? weekRoster(opp.roster, oppAhead.roster, sp) : null;
  const weekInputs: WeekInputs = {
    periods,
    fromPeriod: sp,
    games: data.games,
    slotCounts: data.settings.slotCounts,
    injuries: data.injuries,
    availableFrom: new Map([...myWeek.availableFrom, ...(oppWeek?.availableFrom ?? [])]),
    availableUntil: new Map([...myWeek.availableUntil, ...(oppWeek?.availableUntil ?? [])]),
    lines: new Map(data.scoreboard.map((g) => [g.gameId, g])),
    defense: data.defense,
    outUntil: new Map(
      [...absences([...myWeek.roster, ...(oppWeek?.roster ?? [])], data.injuries, sp)].map(
        ([id, a]) => [id, a.outUntil],
      ),
    ),
  };
  const mine = projectTeamWeek(myWeek.roster, {
    ...weekInputs,
    todayRemaining: remainingToday(myToday, scoreboard),
  });
  const theirs = oppWeek
    ? projectTeamWeek(oppWeek.roster, {
        ...weekInputs,
        todayRemaining: remainingToday(oppToday!, scoreboard),
      })
    : null;
  const pWin = theirs
    ? winProbability(myBanked, mine.remaining, oppBanked, theirs.remaining)
    : null;
  return {
    mp,
    periods,
    opp,
    myPending: pendingMoves(data.me.roster, data.ahead.me.roster),
    oppPending: opp && oppAhead ? pendingMoves(opp.roster, oppAhead.roster) : null,
    myBanked,
    oppBanked,
    myToday,
    oppToday,
    weekInputs,
    myWeekRoster: myWeek.roster,
    mine,
    theirs,
    pWin,
  };
}

/**
 * Today's remaining points for a day board: the best lineup among players whose games haven't
 * started, plus the rest of the games in progress for players starting in them (banked points
 * cover the part already played).
 */
export function remainingToday(rows: DayRow[], scoreboard: Map<number, ScoreboardGame>): number {
  return rows.reduce((a, r) => {
    if (!r.locked) return a + (isStarting(r.recommendedSlot) ? r.value : 0);
    const g = r.game && scoreboard.get(r.game.gameId);
    return g && g.state === "in" && isStarting(r.currentSlot)
      ? a + r.value * (1 - gameElapsed(g))
      : a;
  }, 0);
}

/**
 * Every team's points for this week as of the end of today: live totals (games in progress
 * included) plus the expected rest of today. A run during the day banks these and starts
 * simulating from tomorrow.
 */
export function weekPointsThroughToday(data: LeagueData, sp: number): Map<number, number> {
  const mp = matchupPeriodOf(sp);
  const scoreboard = new Map(data.scoreboard.map((g) => [g.gameId, g]));
  const todayGames = data.games.filter((g) => g.scoringPeriodId === sp);
  const out = new Map<number, number>();
  for (const m of data.matchups.filter((x) => x.period === mp)) {
    const sides: [number | null, number | null][] = [
      [m.homeTeamId, m.homeLive],
      [m.awayTeamId, m.awayLive],
    ];
    for (const [teamId, live] of sides) {
      const team = data.teams.find((t) => t.id === teamId);
      if (!team) continue;
      const rows = buildDayBoard({
        defense: data.defense,
        roster: team.roster,
        slotCounts: data.settings.slotCounts,
        games: todayGames,
        scoreboard: data.scoreboard,
        injuries: data.injuries,
        lineups: data.lineups,
      }).rows;
      out.set(team.id, (live ?? 0) + remainingToday(rows, scoreboard));
    }
  }
  return out;
}
