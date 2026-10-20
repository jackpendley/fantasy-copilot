import { describe, expect, it } from "vitest";
import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { acceptance, marketContext, marketValue } from "@/lib/nba/market";
import {
  applyTrade,
  evaluateTrade,
  findTradeTargets,
  rawValue,
  teamValue,
  valueContext,
} from "@/lib/nba/trade";

// Synthetic players and schedule: every pro team plays days 1-10. 70 projected games each,
// so every player is worth fppg x 70/82 per game played.
const SLOTS = { PG: 1, C: 1, UTIL: 1, BE: 1 };
const games: ProGame[] = [];
for (let day = 1; day <= 10; day++)
  for (let t = 1; t <= 30; t += 2)
    games.push({
      gameId: day * 100 + t,
      scoringPeriodId: day,
      date: 0,
      homeProTeamId: t,
      awayProTeamId: t + 1,
    });
const p = (id: number, pos: string, fppg: number, dollars = 5): RosterPlayer => ({
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
  market: { adp: null, auctionAvg: dollars, espnRank: null, espnAuction: null, seasonRank: null },
});
const k = 70 / 82;
// regularWeeks 1: days 1-6 are week 1 (regular season), days 7+ count as playoffs.
// Active roster limit is 4 (PG, C, UTIL, BE).
const ctx = valueContext(games, SLOTS, 1, 10, 1);

const mine = [p(1, "C", 30, 20), p(2, "C", 28, 15), p(3, "C", 26, 10), p(4, "PG", 10, 1)];
const theirs = [p(5, "PG", 30, 20), p(6, "PG", 28, 15), p(7, "PG", 26, 10), p(8, "C", 10, 1)];
const market = marketContext([...mine, ...theirs], new Map());

describe("teamValue", () => {
  it("counts the best daily lineup, split into regular season and playoffs", () => {
    const v = teamValue(mine, ctx);
    const perDay = (30 + 28 + 10) * k; // C, UTIL, PG
    expect(v.regular).toBeCloseTo(6 * perDay, 6);
    expect(v.playoffs).toBeCloseTo(4 * perDay, 6);
  });
});

describe("evaluateTrade", () => {
  it("finds a positional swap that helps both lineups even at equal value", () => {
    const e = evaluateTrade(
      { teamId: 1, roster: mine },
      { teamId: 2, roster: theirs },
      [mine[2]!],
      [theirs[2]!],
      ctx,
      { market },
    );
    // Third C was benched; the third PG replaces a 10-point PG: +16 a day for both sides.
    expect(e.mine.regular).toBeCloseTo(6 * 16 * k, 6);
    expect(e.mine.playoffs).toBeCloseTo(4 * 16 * k, 6);
    expect(e.theirs.regular).toBeCloseTo(6 * 16 * k, 6);
    expect(e.rawGap).toBeCloseTo(0, 6);
    expect(e.acceptance?.realism).toBe("fair"); // $10 for $10, nothing extra for them
  });
  it("measures raw value as fppg x games", () => {
    expect(rawValue([mine[0]!], ctx)).toBeCloseTo(30 * k * 10, 6);
  });
});

describe("applyTrade (uneven deals)", () => {
  const fa = [p(20, "PG", 18, 1), p(21, "C", 12, 1)];
  it("the side receiving more players drops its least valuable", () => {
    const r = applyTrade(mine, [mine[0]!], [theirs[0]!, theirs[1]!], ctx, fa);
    expect(r.moves.dropped.map((x) => x.id)).toEqual([4]); // the 10-point PG goes
    expect(r.roster.filter((x) => x.slot !== "IR")).toHaveLength(4);
  });
  it("the side receiving fewer adds the best free agents, never the same one twice", () => {
    const taken = new Set<number>();
    const a = applyTrade(theirs, [theirs[0]!, theirs[1]!], [mine[0]!], ctx, fa, taken);
    const b = applyTrade(theirs, [theirs[0]!, theirs[1]!], [mine[0]!], ctx, fa, taken);
    expect(a.moves.added.map((x) => x.id)).toEqual([20]);
    expect(b.moves.added.map((x) => x.id)).toEqual([21]);
  });
});

describe("market value and acceptance", () => {
  it("blends ESPN auction prices with this league's draft slot", () => {
    const pool = [p(30, "C", 40, 60), p(31, "C", 30, 30), p(32, "C", 20, 10)];
    const ctxDraft = marketContext(pool, new Map([[32, 1]])); // drafted 1st overall here
    // ESPN says $10, but this league took him 1st (the $60 slot): average $35.
    expect(marketValue(pool[2]!, ctxDraft)).toBeCloseTo(35, 6);
    expect(marketValue(pool[0]!, ctxDraft)).toBeCloseTo(60, 6);
  });
  it("rejects a star for a scrub even when projections call it even", () => {
    // Same projection, very different market: the Brown-for-Collins case.
    const star = p(40, "SF", 24, 20);
    const scrub = p(41, "PF", 24.6, 2);
    const a = acceptance([star], [scrub], 0, market);
    expect(a.realism).toBe("long shot");
  });
  it("asks for a premium when the partner consolidates away his best player", () => {
    const best = p(50, "C", 40, 30);
    const fair = acceptance([best], [p(51, "C", 20, 16.5), p(52, "C", 20, 16.5)], 0, market);
    const short = acceptance([best], [p(53, "C", 20, 14), p(54, "C", 20, 14)], 0, market);
    expect(fair.required).toBeCloseTo(33, 6); // $30 + 10%
    expect(fair.realism).not.toBe("long shot");
    expect(short.realism).toBe("long shot"); // $28 for $30 + premium
  });
  it("calls it likely when they gain market value and their lineup improves", () => {
    expect(acceptance([p(60, "C", 20, 10)], [p(61, "C", 20, 12)], 5, market).realism).toBe(
      "likely",
    );
  });
});

describe("findTradeTargets", () => {
  it("suggests the positional swap and never a lopsided market deal", () => {
    const ideas = findTradeTargets(
      { teamId: 1, roster: mine },
      [{ teamId: 2, roster: theirs }],
      ctx,
      market,
    );
    expect(ideas.length).toBeGreaterThan(0);
    // Gives up a center, gets a point guard, at about even market value.
    const top = ideas[0]!;
    expect(top.partnerId).toBe(2);
    expect(top.give.every((x) => x.positions[0] === "C")).toBe(true);
    expect(top.get.some((x) => x.positions[0] === "PG")).toBe(true);
    for (const i of ideas) expect(i.acceptance?.realism).not.toBe("long shot");
    // Never their $20 guard for Jack's $1 guard.
    expect(
      ideas.some((i) => i.get.some((x) => x.id === 5) && i.give.every((x) => x.id === 4)),
    ).toBe(false);
  });
});
