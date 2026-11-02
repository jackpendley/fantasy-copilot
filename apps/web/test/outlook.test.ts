import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseMatchups,
  parseSettings,
  parseTeams,
  type ProGame,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import { buildOutlookInput, managerActivity } from "@/lib/nba/outlook";

const league = JSON.parse(
  readFileSync(
    new URL("../../../packages/espn/test/fixtures/league.json", import.meta.url),
    "utf8",
  ),
);

describe("managerActivity", () => {
  it("uses last season's counts for a returning owner before any games", () => {
    // Synthetic counts: a daily manager (400 moves, 22 adds) vs. one who rarely checks.
    expect(managerActivity(null, { lineupMoves: 400, adds: 22 }, 0)).toEqual({
      act: 1,
      addsPerWeek: 1,
    });
    expect(managerActivity(null, { lineupMoves: 40, adds: 0 }, 0).act).toBeCloseTo(0.1, 6);
  });
  it("falls back to a neutral prior for new owners", () => {
    expect(managerActivity(null, null, 0)).toEqual({ act: 0.7, addsPerWeek: 0.6 });
  });
  it("lets this season's behavior take over as days pass", () => {
    const quit = { lineupMoves: 0, adds: 0 };
    const prior = { lineupMoves: 400, adds: 22 };
    const early = managerActivity(quit, prior, 7).act;
    const late = managerActivity(quit, prior, 90).act;
    expect(early).toBeGreaterThan(late);
    expect(late).toBeLessThan(0.25);
  });
});

describe("buildOutlookInput", () => {
  it("banks the current week's points and leaves undecided weeks open", () => {
    const settings = parseSettings(league);
    const matchups = parseMatchups(league).map((m) =>
      m.period === 1 ? { ...m, homePoints: 120, awayPoints: 80 } : m,
    );
    const { input } = buildOutlookInput({
      teams: parseTeams(league),
      previousTeams: null,
      freeAgents: [],
      games: [],
      matchups,
      slotCounts: settings.slotCounts,
      addCapPerWeek: 3,
      regularWeeks: settings.regularSeasonWeeks,
      fromDay: 3, // mid week 1
      seasons: 1,
    });
    const week1 = matchups.find((m) => m.period === 1 && m.awayTeamId != null)!;
    expect(input.banked.get(week1.homeTeamId)?.get(1)).toBe(120);
    expect(input.matchups.every((m) => m.winner === null)).toBe(true);
    expect(input.playoffWeeks).toEqual([20, 21, 22]);
    expect(input.teams.find((t) => t.id === 13)!.roster).toHaveLength(12);
  });
});

describe("IR returns in the simulation", () => {
  it("cuts whoever adds the fewest lineup points, like the Waivers ranking", () => {
    // Synthetic team: one guard and four centers for C, G and UTIL; the 18-point guard starts
    // every game at G, the 20-point fourth center never does. A center returns from IR on day 3.
    const p = (id: number, fppg: number, positions: string[], slot = "BE"): RosterPlayer => ({
      id,
      name: `P${id}`,
      proTeamId: 1,
      proTeam: "ATL",
      positions,
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
    const roster = [
      p(1, 30, ["C"]),
      p(2, 28, ["C"]),
      p(3, 26, ["C"]),
      p(4, 20, ["C"]),
      p(5, 18, ["PG"]),
      p(9, 32, ["C"], "IR"),
    ];
    const games: ProGame[] = Array.from({ length: 20 }, (_, i) => ({
      gameId: i + 1,
      scoringPeriodId: i + 1,
      date: Date.parse("2030-01-01T23:00:00Z") + i * 86_400_000,
      homeProTeamId: 1,
      awayProTeamId: 2,
    }));
    const teams = parseTeams(league).slice(0, 2);
    const { input } = buildOutlookInput({
      teams: [{ ...teams[0]!, roster }, teams[1]!],
      previousTeams: null,
      freeAgents: [],
      games,
      matchups: [],
      slotCounts: { C: 1, G: 1, UTIL: 1, BE: 2, IR: 1 },
      addCapPerWeek: 3,
      regularWeeks: 19,
      fromDay: 1,
      injured: new Map([[9, { outUntil: 3 }]]),
      seasons: 1,
    });
    // The lowest projection is the guard (18), but he starts; the fourth center (20) doesn't.
    expect(input.teams[0]!.irCut).toBe(4);
    expect(input.teams[1]!.irCut).toBeUndefined();
  });
});
