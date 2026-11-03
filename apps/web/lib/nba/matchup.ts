// A week's head-to-head: banked points, projected remaining for both sides, win chance.
// Shared by /nba/week and /nba/waivers so both use the same baseline. This week is live; a
// past week is its final; a later week is projected from today's rosters and injuries.

import type { FantasyTeam } from "@fantasy-copilot/espn";
import type { ScoreboardGame } from "@fantasy-copilot/nba-data";
import { matchupPeriodOf, scoringPeriodsOf } from "./calendar";
import type { loadLeague } from "./data";
import { buildDayBoard, type DayRow } from "./day";
import { absences } from "./availability";
import { gameElapsed, isStarting } from "./live";
import { pendingMoves, weekRoster, type PendingMoves } from "./roster";
import { projectTeamWeek, startSd, winProbability, type TeamWeek, type WeekInputs } from "./week";

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
  oppWeekRoster: FantasyTeam["roster"] | null;
  mine: TeamWeek;
  theirs: TeamWeek | null;
  pWin: number | null;
}

/** The league as seen by another team: it becomes `me` (as in recordMatchupStates). */
export function asTeam(data: LeagueData, teamId: number): LeagueData {
  const me = data.teams.find((t) => t.id === teamId);
  const ahead = data.ahead.teams.find((t) => t.id === teamId);
  if (!me || !ahead) return data;
  return { ...data, me, ahead: { ...data.ahead, me: ahead } };
}

/**
 * `perGame`: today's projections to use instead of our model's (the props blend,
 * lib/nba/best.ts). `week`: another matchup week than today's (past: final; later: projected).
 */
export function matchupView(
  data: LeagueData,
  sp: number,
  perGame?: Map<number, number>,
  week?: number,
): MatchupView {
  const now = matchupPeriodOf(sp);
  const mp = week ?? now;
  const periods = scoringPeriodsOf(mp);
  const past = mp < now;
  const later = mp > now;
  const matchup = data.matchups.find(
    (m) => m.period === mp && (m.homeTeamId === data.me.id || m.awayTeamId === data.me.id),
  );
  const iAmHome = matchup?.homeTeamId === data.me.id;
  const oppId = matchup ? (iAmHome ? matchup.awayTeamId : matchup.homeTeamId) : null;
  const opp = data.teams.find((t) => t.id === oppId);
  const oppAhead = data.ahead.teams.find((t) => t.id === oppId);
  // Live totals this week; a past week's finals; nothing yet in a later week.
  const banked = (home: boolean) =>
    !matchup || later
      ? 0
      : past
        ? ((home ? matchup.homePoints : matchup.awayPoints) ?? 0)
        : ((home ? matchup.homeLive : matchup.awayLive) ?? 0);
  const myBanked = banked(iAmHome);
  const oppBanked = banked(!iAmHome);

  // Today's games only count in today's week.
  const todayGames = past || later ? [] : data.games.filter((g) => g.scoringPeriodId === sp);
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
    // A past week has nothing left to project; a later week starts on its first day.
    fromPeriod: past ? periods.at(-1)! + 1 : later ? periods[0]! : sp,
    asOf: sp,
    // Today's games with the same values as the day boards (what-ifs on Moves use these).
    todayValues: perGame,
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
  const today = (rows: DayRow[]) =>
    past || later
      ? {}
      : {
          todayRemaining: remainingToday(rows, scoreboard),
          todayVar: remainingTodayVar(rows, scoreboard),
        };
  const mine = projectTeamWeek(myWeek.roster, { ...weekInputs, ...today(myToday) });
  const theirs = oppWeek
    ? projectTeamWeek(oppWeek.roster, { ...weekInputs, ...today(oppToday!) })
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
    oppWeekRoster: oppWeek?.roster ?? null,
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
  return todayLeft(rows, scoreboard).reduce((a, x) => a + x.value * x.left, 0);
}

/**
 * The same starts' variance still to come: each player's spread (startSd) squared, scaled by
 * the share of his game left (MODEL_CARD.md, candidate C).
 */
export function remainingTodayVar(rows: DayRow[], scoreboard: Map<number, ScoreboardGame>): number {
  return todayLeft(rows, scoreboard).reduce((a, x) => a + startSd(x.value) ** 2 * x.left, 0);
}

/** Today's starters still to play: their full-game projection and the share of it left. */
function todayLeft(rows: DayRow[], scoreboard: Map<number, ScoreboardGame>) {
  const out: { value: number; left: number }[] = [];
  for (const r of rows) {
    if (!r.locked) {
      if (isStarting(r.recommendedSlot) && r.value > 0) out.push({ value: r.value, left: 1 });
      continue;
    }
    const g = r.game && scoreboard.get(r.game.gameId);
    if (g && g.state === "in" && isStarting(r.currentSlot) && r.value > 0) {
      out.push({ value: r.value, left: 1 - gameElapsed(g) });
    }
  }
  return out;
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

/** One league matchup in a week, from the home side: points, projected finals, win chance. */
export interface LeagueMatchup {
  id: number;
  homeId: number;
  awayId: number;
  home: number;
  away: number;
  homeFinal: number;
  awayFinal: number;
  pHome: number | null;
  /** Nothing left to play. */
  decided: boolean;
}

/** Every matchup in `week` (byes skipped), each seen from its home team. */
export function leagueMatchups(
  data: LeagueData,
  sp: number,
  week: number,
  perGame?: Map<number, number>,
): LeagueMatchup[] {
  return data.matchups
    .filter((m) => m.period === week && m.awayTeamId != null)
    .map((m) => {
      const v = matchupView(asTeam(data, m.homeTeamId), sp, perGame, week);
      const left = v.mine.remaining + (v.theirs?.remaining ?? 0);
      return {
        id: m.id,
        homeId: m.homeTeamId,
        awayId: m.awayTeamId!,
        home: v.myBanked,
        away: v.oppBanked,
        homeFinal: v.myBanked + v.mine.remaining,
        awayFinal: v.oppBanked + (v.theirs?.remaining ?? 0),
        pHome: v.pWin,
        decided: left < 0.5 && week <= matchupPeriodOf(sp),
      };
    });
}
