import "server-only";
// The league at a glance: every team's record, lineup strength for the rest of the season,
// and (when the outlook has run) playoff and title odds.

import { dbConfigured } from "@/lib/db";
import { LAST_SCORING_PERIOD, etDate, matchupPeriodOf, scoringPeriodForDate } from "./calendar";
import { loadDraftPicks, loadFreeAgents, loadLeague } from "./data";
import { absences } from "./availability";
import { marketContext } from "./market";
import { latestOutlook } from "./outlook-run";
import { teamValue, valueContext, type TeamValue } from "./trade";

export async function loadLeagueView(now = new Date()) {
  const date = etDate(now);
  const sp = Math.min(Math.max(scoringPeriodForDate(date), 1), LAST_SCORING_PERIOD);
  const [league, outlook, freeAgents, draftPicks] = await Promise.all([
    loadLeague(sp, date),
    dbConfigured() ? latestOutlook().catch(() => null) : Promise.resolve(null),
    loadFreeAgents(sp).catch(() => []),
    loadDraftPicks().catch(() => new Map<number, number>()),
  ]);
  // Rosters as they stand from tomorrow: moves made after today's lock count for everything
  // forward-looking here (strength, trades, team pages).
  const data = { ...league, teams: league.ahead.teams, me: league.ahead.me };
  const free = freeAgents.map((f) => f.player);
  const market = marketContext([...data.teams.flatMap((t) => t.roster), ...free], draftPicks);
  // Injured players count from their estimated return (ESPN's injury feed).
  const injured = absences([...data.teams.flatMap((t) => t.roster), ...free], data.injuries, sp);
  const ctx = valueContext(
    data.games,
    data.settings.slotCounts,
    sp,
    LAST_SCORING_PERIOD,
    data.settings.regularSeasonWeeks,
    injured,
  );
  const weeksLeft = Math.max(1, data.settings.regularSeasonWeeks - matchupPeriodOf(sp) + 1);
  const odds = new Map((outlook?.results ?? []).map((r) => [r.teamId, r]));
  const values = new Map<number, TeamValue>(
    data.teams.map((t) => [t.id, teamValue(t.roster, ctx)]),
  );
  const teams = data.teams.map((t) => ({
    team: t,
    mine: t.id === data.me.id,
    value: values.get(t.id)!,
    /** Projected starting points per regular-season week from here on. */
    perWeek: values.get(t.id)!.regular / weeksLeft,
    odds: odds.get(t.id) ?? null,
  }));
  const byStrength = [...teams].sort((a, b) => b.perWeek - a.perWeek);
  const power = new Map(byStrength.map((t, i) => [t.team.id, i + 1]));
  return {
    sp,
    data,
    ctx,
    teams,
    power,
    market,
    freeAgents: free,
    injured,
    outlookAt: outlook?.run_at ?? null,
  };
}
