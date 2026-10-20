import "server-only";
// Daily win-chance snapshots for the current matchup (written by the nightly job).

import { db } from "@/lib/db";
import { LAST_SCORING_PERIOD, etDate, scoringPeriodForDate } from "./calendar";
import { loadLeague } from "./data";
import { matchupView } from "./matchup";

export async function recordMatchupSnapshot(now = new Date()) {
  const date = etDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const v = matchupView(await loadLeague(sp, date), sp);
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

export async function matchupHistory(matchupPeriod: number) {
  return db()<
    { scoring_period: number; p_win: number; my_projected: number; opp_projected: number }[]
  >`
    select distinct on (scoring_period) scoring_period, p_win, my_projected, opp_projected
    from matchup_snapshots where matchup_period = ${matchupPeriod}
    order by scoring_period, taken_at asc
  `;
}
