import { describe, expect, it } from "vitest";
import type { FantasyTeam, Matchup, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { asTeam, leagueMatchups, matchupView, weekPointsThroughToday } from "@/lib/nba/matchup";
import { startSd } from "@/lib/nba/week";

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
  ties: 0,
  pointsFor: 0,
  activity: null,
  roster,
  watchList: [],
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
    defense: null,
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

  it("sums each remaining start's spread into the week's variance", () => {
    const v = matchupView(league([player(1, 30)], [player(1, 30)]), 1);
    // One starter, a game every day: today (from the day board) plus five days ahead.
    expect(startSd(30)).toBeCloseTo(15.4);
    expect(v.mine.startVar).toBeCloseTo(6 * 15.4 ** 2, 1);
    expect(v.theirs!.startVar).toBeCloseTo(6 * 15.4 ** 2, 1);
  });
});

describe("matchupView for other weeks and teams", () => {
  // Two weeks: week 1 (days 1-6) is over, week 2 is days 7-13; pro team 1 plays every day.
  function twoWeeks(meRoster: RosterPlayer[]) {
    const base = league(meRoster, meRoster);
    const allGames: ProGame[] = Array.from({ length: 13 }, (_, i) => ({
      gameId: i + 1,
      scoringPeriodId: i + 1,
      date: Date.parse("2030-01-01T23:00:00Z") + i * 86_400_000,
      homeProTeamId: 1,
      awayProTeamId: 2,
    }));
    const week1: Matchup = { ...matchup, homePoints: 500, awayPoints: 450, winner: "HOME" };
    const week2: Matchup = { ...matchup, id: 2, period: 2, homeLive: 0, awayLive: 0 };
    return { ...base, games: allGames, matchups: [week1, week2] };
  }

  it("shows a past week's final", () => {
    const v = matchupView(twoWeeks([player(1, 30)]), 8, undefined, 1);
    expect(v.mp).toBe(1);
    expect([v.myBanked, v.oppBanked]).toEqual([500, 450]);
    expect(v.mine.remaining).toBe(0);
    expect(v.pWin).toBe(1);
  });

  it("projects a later week from today, with today's day-to-day status fading out", () => {
    const hurt = { ...player(1, 30), injuryStatus: "DAY_TO_DAY" };
    const v = matchupView(twoWeeks([hurt]), 1, undefined, 2);
    expect(v.mp).toBe(2);
    expect(v.myBanked).toBe(0);
    expect(v.myToday.some((r) => r.game)).toBe(false); // today's games aren't this week's
    // Seven games at 30: the first is 6 days out (a day-to-day player plays ~75% of those);
    // from 7 days on he counts fully.
    expect(v.mine.remaining).toBeCloseTo(30 * (0.751 + 6), 1);
    expect(v.mine.startsByDay.get(7)).toEqual(new Set([1]));
  });

  it("sees any team's matchup, and every matchup of the week", () => {
    const data = twoWeeks([player(1, 30)]);
    const v = matchupView(asTeam(data, 2), 8);
    expect(v.opp?.id).toBe(1);
    const all = leagueMatchups(data, 8, 2);
    expect(all).toHaveLength(1);
    expect(all[0]!.homeId).toBe(1);
    expect(all[0]!.pHome).toBeCloseTo(0.5, 1); // 30 a game each, nothing banked yet
  });
});

describe("day-to-day players on later days", () => {
  it("play at the fitted rates for six days, then count as healthy", async () => {
    const { playChance, DAY_TO_DAY_AHEAD } = await import("@/lib/nba/week");
    expect(playChance("DAY_TO_DAY", 0)).toBe(0.75); // today: his status's own chance
    expect(playChance("DAY_TO_DAY", 1)).toBe(DAY_TO_DAY_AHEAD[0]);
    expect(playChance("DAY_TO_DAY", 6)).toBe(DAY_TO_DAY_AHEAD[5]);
    expect(playChance("DAY_TO_DAY", 7)).toBe(1);
    expect(playChance("OUT", 3)).toBe(0);
    expect(playChance("ACTIVE", 2)).toBe(1);
  });
});

describe("today's blended values", () => {
  it("replace ours for today's games only, in week projections and the win chance", async () => {
    const { projectTeamWeek } = await import("@/lib/nba/week");
    const data = league([player(1, 30)], [player(1, 30)]);
    const plain = matchupView(data, 1);
    const blended = matchupView(data, 1, new Map([[1, 40]]));
    // Today's board and the week inputs both use 40 for player 1 today; later days stay at 30.
    expect(blended.mine.remaining - plain.mine.remaining).toBeCloseTo(10, 5);
    const week = projectTeamWeek([player(1, 30)], blended.weekInputs);
    const ours = projectTeamWeek([player(1, 30)], plain.weekInputs);
    expect(week.projectedByDay.get(1)! - ours.projectedByDay.get(1)!).toBeCloseTo(10, 5);
    expect(week.projectedByDay.get(2)).toBeCloseTo(ours.projectedByDay.get(2)!, 5);
    expect(blended.pWin!).toBeGreaterThan(plain.pWin!);
  });
});
