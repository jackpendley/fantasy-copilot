import { describe, expect, it } from "vitest";
import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import {
  evaluateTrade,
  findTradeTargets,
  rawValue,
  teamValue,
  valueContext,
} from "@/lib/nba/trade";

// Synthetic players and schedule: every pro team plays days 1-10. 70 projected games each,
// so every player is worth fppg x 70/82 per game played.
const SLOTS = { PG: 1, C: 1, UTIL: 1, BE: 3 };
const games: ProGame[] = [];
for (let day = 1; day <= 10; day++)
  for (let t = 1; t <= 8; t += 2)
    games.push({
      gameId: day * 100 + t,
      scoringPeriodId: day,
      date: 0,
      homeProTeamId: t,
      awayProTeamId: t + 1,
    });
const p = (id: number, pos: string, fppg: number): RosterPlayer => ({
  id,
  name: `${pos}${id}`,
  proTeamId: id,
  proTeam: "X",
  positions: [pos],
  slot: "BE",
  injuryStatus: "ACTIVE",
  percentOwned: 0,
  percentChange: 0,
  projection: { avg: fppg, total: fppg * 70, stats: {} },
  season: null,
  last7: null,
  last15: null,
  last30: null,
});
const k = 70 / 82;
// regularWeeks 1: days 1-6 are week 1 (regular season), days 7+ count as playoffs.
const ctx = valueContext(games, SLOTS, 1, 10, 1);

const mine = [p(1, "C", 30), p(2, "C", 28), p(3, "C", 26), p(4, "PG", 10)];
const theirs = [p(5, "PG", 30), p(6, "PG", 28), p(7, "PG", 26), p(8, "C", 10)];

describe("teamValue", () => {
  it("counts the best daily lineup, split into regular season and playoffs", () => {
    const v = teamValue(mine, ctx);
    const perDay = (30 + 28 + 10) * k; // C, UTIL, PG
    expect(v.regular).toBeCloseTo(6 * perDay, 6);
    expect(v.playoffs).toBeCloseTo(4 * perDay, 6);
  });
});

describe("evaluateTrade", () => {
  it("finds a positional swap that helps both lineups even at equal raw value", () => {
    const e = evaluateTrade(
      { teamId: 1, roster: mine },
      { teamId: 2, roster: theirs },
      [mine[2]!],
      [theirs[2]!],
      ctx,
    );
    // Third C was benched; the third PG replaces a 10-point PG: +16 a day for both sides.
    expect(e.mine.regular).toBeCloseTo(6 * 16 * k, 6);
    expect(e.mine.playoffs).toBeCloseTo(4 * 16 * k, 6);
    expect(e.theirs.regular).toBeCloseTo(6 * 16 * k, 6);
    expect(e.rawGap).toBeCloseTo(0, 6);
  });
  it("measures raw value as fppg x games", () => {
    expect(rawValue([mine[0]!], ctx)).toBeCloseTo(30 * k * 10, 6);
  });
});

describe("findTradeTargets", () => {
  it("suggests the positional swap and skips deals the partner wouldn't take", () => {
    const ideas = findTradeTargets(
      { teamId: 1, roster: mine },
      [{ teamId: 2, roster: theirs }],
      ctx,
    );
    expect(ideas.length).toBeGreaterThan(0);
    const top = ideas[0]!;
    expect(top.partnerId).toBe(2);
    // Gives up a center, gets a point guard of no more raw value than he sends.
    expect(top.give[0]!.positions).toEqual(["C"]);
    expect(top.get[0]!.positions).toEqual(["PG"]);
    expect(rawValue(top.give, ctx)).toBeGreaterThanOrEqual(0.95 * rawValue(top.get, ctx));
    // Never asks for their 30-point guard in exchange for a weaker player.
    expect(ideas.some((i) => i.get[0]!.id === 5 && i.give[0]!.id !== 1)).toBe(false);
  });
});
