import { describe, expect, it } from "vitest";
import type { FantasyTeam, Matchup, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { matchupView, weekPointsThroughToday } from "@/lib/nba/matchup";

// Synthetic league: two teams, one matchup in week 1 (days 1-6). Pro team 1 plays every day.
// Tip times are far in the future so nothing counts as started.
const player = (id: number, fppg: number, slot = "UTIL"): RosterPlayer => ({
  id,
  name: `P${id}`,
  proTeamId: 1,
  proTeam: "ATL",
  positions: ["PG", "SG", "SF", "PF", "C"],
  slot,
  injuryStatus: "ACTIVE",
  percentOwned: 50,
  percentChange: 0,
  projection: { avg: fppg, total: fppg * 70, stats: {} },
  season: null,
  last7: null,
  last15: null,
  last30: null,
});
const team = (id: number, roster: RosterPlayer[]): FantasyTeam => ({
  id,
  name: `Team ${id}`,
  abbrev: `T${id}`,
  ownerId: null,
  wins: 0,
  losses: 0,
  pointsFor: 0,
  activity: null,
  roster,
});
const games: ProGame[] = [1, 2, 3, 4, 5, 6].map((d) => ({
  gameId: d,
  scoringPeriodId: d,
  date: Date.parse(`2030-01-0${d}T23:00:00Z`),
  homeProTeamId: 1,
  awayProTeamId: 2,
}));
const matchup: Matchup = {
  id: 1,
  period: 1,
  homeTeamId: 1,
  awayTeamId: 2,
  homePoints: 0,
  awayPoints: 0,
  homeLive: 50,
  awayLive: 20,
  homeByPeriod: {},
  awayByPeriod: {},
  winner: "UNDECIDED",
};

function league(meToday: RosterPlayer[], meAhead: RosterPlayer[]) {
  const teams = [team(1, meToday), team(2, [player(20, 30)])];
  const ahead = [team(1, meAhead), teams[1]!];
  return {
    settings: {
      name: "",
      scoring: {},
      slotCounts: { UTIL: 2, BE: 3 },
      benchUnlimited: false,
      lineupLock: "INDIVIDUAL_GAME",
      rosterLock: "FIRSTGAME_SCORINGPERIOD",
      regularSeasonWeeks: 19,
      playoffTeams: 6,
      addsPerWeek: 3,
    },
    teams,
    me: teams[0]!,
    ahead: { teams: ahead, me: ahead[0]! },
    matchups: [matchup],
    games,
    scoreboard: [],
    injuries: [],
    lineups: null,
    warnings: [],
  };
}

describe("matchupView with moves that take effect tomorrow", () => {
  it("counts an add from tomorrow and a drop through today", () => {
    const keep = player(1, 30);
    const dropped = player(2, 20);
    const added = player(3, 40, "BE");
    const v = matchupView(league([keep, dropped], [keep, added]), 1);
    expect(v.myPending.adds.map((p) => p.id)).toEqual([3]);
    expect(v.myPending.drops.map((p) => p.id)).toEqual([2]);
    // Today: keep + dropped start. Tomorrow on: keep + added.
    expect(v.mine.startsByDay.get(1)).toEqual(new Set([1, 2]));
    expect(v.mine.startsByDay.get(2)).toEqual(new Set([1, 3]));
    expect(v.myWeekRoster.map((p) => p.id).sort()).toEqual([1, 2, 3]);
  });

  it("raises the projection and win chance when the add is better than the drop", () => {
    const keep = player(1, 30);
    const before = matchupView(league([keep, player(2, 20)], [keep, player(2, 20)]), 1);
    const after = matchupView(league([keep, player(2, 20)], [keep, player(3, 40)]), 1);
    // Five days at +20 (40 instead of 20), today unchanged.
    expect(after.mine.remaining - before.mine.remaining).toBeCloseTo(100, 0);
    expect(after.pWin!).toBeGreaterThan(before.pWin!);
  });

  it("banks live points plus the rest of today for every team", () => {
    const pts = weekPointsThroughToday(league([player(1, 30)], [player(1, 30)]), 1);
    // Nothing has started: live 50 + today's projection 30 (and 20 + 30 for the opponent).
    expect(pts.get(1)).toBeCloseTo(80);
    expect(pts.get(2)).toBeCloseTo(50);
  });
});
