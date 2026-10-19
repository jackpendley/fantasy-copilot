import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMatchups, parseSettings, parseTeams } from "@fantasy-copilot/espn";
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
