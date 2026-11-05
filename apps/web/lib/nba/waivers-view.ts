import "server-only";
// Everything the waivers page and the add/drop API need, computed the same way for both,
// so the server can re-check a move against fresh data before writing it.

import { isStartingSlot } from "@fantasy-copilot/fantasy-core";
import {
  LAST_SCORING_PERIOD,
  gameDate,
  matchupPeriodOf,
  scoringPeriodForDate,
  scoringPeriodsOf,
} from "./calendar";
import { loadFreeAgents, loadLeague } from "./data";
import { buildDayBoard } from "./day";
import { matchupView } from "./matchup";
import { absences } from "./availability";
import { rosterLocked } from "./roster";
import { valueContext } from "./trade";
import { bestPerGame } from "./best";
import { rosteredPercentile } from "./projection";
import { waiverAnalysis, waiverCandidates } from "./waivers";
import { memoAsync } from "@/lib/fetch-memo";

/**
 * Moves' data, kept 30 seconds per server instance so switching tabs and coming back doesn't
 * redo the add-and-drop analysis (forgetResponses(), e.g. before an add, clears it).
 */
export const loadWaiverView = memoAsync(30_000, () => gameDate(), readWaiverView);

/** Which teams' games today have started (an add can't play in them). */
function startedTeams(data: Awaited<ReturnType<typeof loadLeague>>, sp: number, now: Date) {
  const live = new Map(data.scoreboard.map((g) => [g.gameId, g]));
  const started = new Set<number>();
  for (const g of data.games.filter((x) => x.scoringPeriodId === sp)) {
    const s = live.get(g.gameId);
    if (s ? s.state !== "pre" : g.date <= now.getTime()) {
      started.add(g.homeProTeamId);
      started.add(g.awayProTeamId);
    }
  }
  return started;
}

/** The Free agents view: the pool with this week's games and season points, no analysis. */
export async function loadFreeAgentPool(now = new Date()) {
  const date = gameDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const [data, freeAgents] = await Promise.all([loadLeague(sp, date), loadFreeAgents(sp)]);
  const todayGames = data.games.filter((g) => g.scoringPeriodId === sp);
  const { candidates } = waiverCandidates({
    freeAgents,
    week: {
      periods: scoringPeriodsOf(matchupPeriodOf(sp)),
      fromPeriod: sp,
      games: data.games,
      slotCounts: data.settings.slotCounts,
      injuries: data.injuries,
    },
    rosterLocked: rosterLocked(
      data.settings,
      todayGames.map((g) => g.date),
      data.scoreboard,
      now,
    ),
    startedToday: startedTeams(data, sp, now),
    lastDay: LAST_SCORING_PERIOD,
  });
  const rank = rosteredPercentile(data.teams.flatMap((t) => t.roster));
  return {
    candidates: candidates.map((c) => ({ ...c, fppgPct: rank(c.fppg) })),
    /** Jack's roster as of tomorrow, and the injury feed (to match deep checks to it). */
    roster: data.ahead.me.roster,
    injuries: data.injuries,
  };
}

async function readWaiverView(now = new Date()) {
  const date = gameDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const [data, freeAgents] = await Promise.all([loadLeague(sp, date), loadFreeAgents(sp)]);
  // The props blend for today's games, for rostered players and free agents alike, so this
  // page's win chance and what-ifs match the Matchup page.
  const perGame = await bestPerGame(
    [...data.teams.flatMap((t) => t.roster), ...freeAgents.map((f) => f.player)],
    data,
    sp,
  );
  const view = matchupView(data, sp, perGame);

  const todayGames = data.games.filter((g) => g.scoringPeriodId === sp);
  const board = buildDayBoard({
    defense: data.defense,
    roster: data.me.roster,
    slotCounts: data.settings.slotCounts,
    games: todayGames,
    scoreboard: data.scoreboard,
    injuries: data.injuries,
    lineups: data.lineups,
    now,
  });
  const lockedToday = new Set(board.rows.filter((r) => r.locked).map((r) => r.player.id));
  const live = new Map(data.scoreboard.map((g) => [g.gameId, g]));
  const startedToday = new Set<number>();
  for (const g of todayGames) {
    const s = live.get(g.gameId);
    const started = s ? s.state !== "pre" : g.date <= now.getTime();
    if (started) {
      startedToday.add(g.homeProTeamId);
      startedToday.add(g.awayProTeamId);
    }
  }
  const rosterLimit = Object.entries(data.settings.slotCounts)
    .filter(([slot]) => slot !== "IR")
    .reduce((a, [slot, n]) => a + (isStartingSlot(slot) || slot === "BE" ? n : 0), 0);

  const locked = rosterLocked(
    data.settings,
    todayGames.map((g) => g.date),
    data.scoreboard,
    now,
  );
  const analysis = waiverAnalysis({
    roster: data.ahead.me.roster,
    leaving: view.myPending.drops,
    freeAgents,
    week: view.weekInputs,
    myBanked: view.myBanked,
    oppBanked: view.oppBanked,
    myRemaining: view.mine.remaining,
    oppRemaining: view.theirs?.remaining ?? null,
    lockedToday,
    startedToday,
    rosterLimit,
    irSlots: data.settings.slotCounts.IR ?? 0,
    rosterLocked: locked,
    lastDay: LAST_SCORING_PERIOD,
    // Rest-of-season lineup fit (positions, schedule, injuries, IL returns).
    season: valueContext(
      data.games,
      data.settings.slotCounts,
      sp,
      LAST_SCORING_PERIOD,
      data.settings.regularSeasonWeeks,
      absences([...data.ahead.me.roster, ...freeAgents.map((f) => f.player)], data.injuries, sp),
    ),
  });
  const addsCap = data.settings.addsPerWeek ?? 3;
  const addsUsed = data.me.activity?.addsByPeriod[view.mp] ?? 0;
  return {
    sp,
    date,
    data,
    view,
    freeAgents,
    analysis,
    lockedToday,
    rosterLocked: locked,
    addsCap,
    addsUsed,
  };
}
