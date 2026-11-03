import "server-only";
// Daily win-chance snapshots for the current matchup (written by the nightly job).

import { db } from "@/lib/db";
import { LAST_SCORING_PERIOD, matchupPeriodOf, scoringPeriodForDate, gameDate } from "./calendar";
import { loadLeague } from "./data";
import { leagueMatchups, matchupView } from "./matchup";
import { bestPerGame } from "./best";

export async function recordMatchupSnapshot(now = new Date()) {
  const date = gameDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const data = await loadLeague(sp, date);
  // Today's games with the props blend, as the Matchup page shows them.
  const perGame = await bestPerGame(
    data.teams.flatMap((t) => t.roster),
    data,
    sp,
  );
  const v = matchupView(data, sp, perGame);
  if (!v.theirs || v.pWin == null) return null; // bye week
  const row = {
    matchup_period: v.mp,
    scoring_period: sp,
    my_points: v.myBanked,
    opp_points: v.oppBanked,
    my_projected: v.myBanked + v.mine.remaining,
    opp_projected: v.oppBanked + v.theirs.remaining,
    p_win: v.pWin,
  };
  await db()`insert into matchup_snapshots ${db()(row)}`;
  return row;
}

/**
 * Every matchup in the league this morning, from each home team's side, with the app's own
 * projections (calibration data for the weekly win probability). One row per matchup per day.
 */
export async function recordMatchupStates(now = new Date()) {
  const date = gameDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const data = await loadLeague(sp, date);
  const perGame = await bestPerGame(
    data.teams.flatMap((t) => t.roster),
    data,
    sp,
  );
  const mp = matchupPeriodOf(sp);
  const rows = [];
  for (const m of data.matchups.filter((x) => x.period === mp && x.awayTeamId != null)) {
    const home = data.teams.find((t) => t.id === m.homeTeamId);
    const homeAhead = data.ahead.teams.find((t) => t.id === m.homeTeamId);
    if (!home || !homeAhead) continue;
    const v = matchupView(
      { ...data, me: home, ahead: { ...data.ahead, me: homeAhead } },
      sp,
      perGame,
    );
    if (!v.theirs || v.pWin == null) continue;
    rows.push({
      matchup_period: mp,
      scoring_period: sp,
      home_id: m.homeTeamId,
      away_id: m.awayTeamId!,
      home_points: v.myBanked,
      away_points: v.oppBanked,
      home_remaining: v.mine.remaining,
      away_remaining: v.theirs.remaining,
      home_start_var: v.mine.startVar,
      away_start_var: v.theirs.startVar,
      p_home: v.pWin,
    });
  }
  if (rows.length) {
    await db()`insert into matchup_states ${db()(rows)} on conflict do nothing`;
  }
  return { matchupStates: rows.length };
}

export async function matchupHistory(matchupPeriod: number) {
  return db()<
    { scoring_period: number; p_win: number; my_projected: number; opp_projected: number }[]
  >`
    select distinct on (scoring_period) scoring_period, p_win, my_projected, opp_projected
    from matchup_snapshots where matchup_period = ${matchupPeriod}
    order by scoring_period, taken_at asc
  `;
}

/** Any league matchup's morning win chances (from matchup_states), for its home team. */
export async function matchupStatesHistory(matchupPeriod: number, homeId: number) {
  return db()<{ scoring_period: number; p_home: number }[]>`
    select scoring_period, p_home from matchup_states
    where matchup_period = ${matchupPeriod} and home_id = ${homeId}
    order by scoring_period
  `;
}

/** Every league matchup's win chance now, with the props blend (matchup_timeline). */
export async function recordTimeline(data: Awaited<ReturnType<typeof loadLeague>>, sp: number) {
  const mp = matchupPeriodOf(sp);
  const perGame = await bestPerGame(
    data.teams.flatMap((t) => t.roster),
    data,
    sp,
  );
  const rows = leagueMatchups(data, sp, mp, perGame)
    .filter((m) => m.pHome != null)
    .map((m) => ({
      matchup_period: mp,
      scoring_period: sp,
      home_id: m.homeId,
      away_id: m.awayId,
      home_points: m.home,
      away_points: m.away,
      p_home: m.pHome!,
    }));
  if (rows.length) await db()`insert into matchup_timeline ${db()(rows)}`;
  return rows.length;
}

/** One matchup's win chances through a week (home team's view), oldest first. */
export async function matchupTimeline(matchupPeriod: number, homeId: number) {
  return db()<{ taken_at: Date; p_home: number }[]>`
    select taken_at, p_home from matchup_timeline
    where matchup_period = ${matchupPeriod} and home_id = ${homeId}
    order by taken_at
  `;
}

/** Morning snapshots with their times (Jack's own matchup), oldest first. */
export async function matchupSnapshotsTimed(matchupPeriod: number) {
  return db()<{ taken_at: Date; p_win: number }[]>`
    select taken_at, p_win from matchup_snapshots where matchup_period = ${matchupPeriod}
    order by taken_at
  `;
}

/** The league-wide morning log with times, for a home team. */
export async function matchupStatesTimed(matchupPeriod: number, homeId: number) {
  return db()<{ taken_at: Date; p_home: number }[]>`
    select taken_at, p_home from matchup_states
    where matchup_period = ${matchupPeriod} and home_id = ${homeId}
    order by taken_at
  `;
}
