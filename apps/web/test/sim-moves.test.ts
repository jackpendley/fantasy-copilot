import { describe, expect, it } from "vitest";
import type { FantasyTeam, Matchup, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { applyMove, toWire } from "@fantasy-copilot/fantasy-core";
import { buildOutlookInput } from "@/lib/nba/outlook";
import {
  buildWireMoves,
  groupsOf,
  jobMoveOptions,
  moveKey,
  pickGroup,
  type SimGroup,
} from "@/lib/nba/sim-moves";
import type { StreamOption } from "@/lib/nba/waivers";

// Synthetic league (not real data): 4 teams, pro teams 1-8 play every other day for 20 days.
const SLOTS = { PG: 1, C: 1, UTIL: 2, BE: 1, IR: 1 };
const games: ProGame[] = [];
for (let day = 1; day <= 20; day++)
  for (let t = 1 + (day % 2); t <= 8; t += 2)
    games.push({
      gameId: day * 100 + t,
      scoringPeriodId: day,
      date: 0,
      homeProTeamId: t,
      awayProTeamId: t + 10,
    });
const p = (id: number, pos: string, fppg: number, slot = "BE"): RosterPlayer => ({
  id,
  name: `P${id}`,
  proTeamId: (id % 8) + 1,
  proTeam: "X",
  positions: [pos],
  slot,
  injuryStatus: "ACTIVE",
  percentOwned: 0,
  percentChange: 0,
  projection: { avg: fppg, total: fppg * 70, stats: {} },
  season: null,
  last7: null,
  last15: null,
  last30: null,
  market: { adp: null, auctionAvg: 1, espnRank: null, espnAuction: null, seasonRank: null },
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
const roster = (id: number, base: number) =>
  ["PG", "C", "PG", "C", "PG"].map((pos, i) => p(id * 10 + i, pos, base - i * 2));
// Jack's team (1) is full, with a player on IR who's back on day 5: someone gets cut then.
const mine = [...roster(1, 30), p(19, "C", 26, "IR")];
const teams = [
  team(1, mine),
  team(2, roster(2, 30)),
  team(3, roster(3, 28)),
  team(4, roster(4, 27)),
];
const matchups = [1, 2].flatMap((period, w) =>
  [
    [1, w ? 3 : 2],
    [w ? 2 : 3, 4],
  ].map(
    ([home, away], i) =>
      ({
        id: period * 10 + i,
        period,
        homeTeamId: home,
        awayTeamId: away,
        homePoints: 0,
        awayPoints: 0,
        homeLive: 0,
        awayLive: 0,
        homeByPeriod: {},
        awayByPeriod: {},
        winner: "UNDECIDED",
      }) as Matchup,
  ),
);
const freeAgents = [p(901, "C", 29), p(902, "PG", 24), p(903, "C", 12), p(904, "PG", 8)];
const injured = new Map([
  [19, { outUntil: 5 }],
  [902, { outUntil: 3 }],
]);
const args = {
  previousTeams: null,
  games,
  matchups,
  slotCounts: SLOTS,
  addCapPerWeek: 3,
  regularWeeks: 2,
  fromDay: 1,
  seasons: 0,
};
const option = (add: RosterPlayer, drop: RosterPlayer | null, il: RosterPlayer | null = null) =>
  ({ add: { player: add }, drop, il, netWins: 0 }) as unknown as StreamOption;

describe("moves built as patches on the base season", () => {
  it("equal the season rebuilt with the move made", () => {
    // As in production, the base's absences cover the free agents too (outlookSetup).
    const base = buildOutlookInput({ ...args, teams, freeAgents, injured });
    const wire = toWire(base.input);
    const options = [
      option(freeAgents[0]!, mine[4]!),
      option(freeAgents[1]!, mine[0]!),
      option(freeAgents[3]!, mine[2]!),
    ];
    const moves = buildWireMoves(
      {
        base: wire,
        teamId: 1,
        roster: mine,
        freeAgents,
        games,
        slotCounts: SLOTS,
        fromDay: 1,
        regularWeeks: 2,
        injured,
      },
      options,
    );
    for (const [i, o] of options.entries()) {
      const after = [...mine.filter((x) => x.id !== o.drop!.id), { ...o.add.player, slot: "BE" }];
      const full = buildOutlookInput({
        ...args,
        teams: teams.map((t) => (t.id === 1 ? { ...t, roster: after } : t)),
        freeAgents: [...freeAgents.filter((f) => f.id !== o.add.player.id), o.drop!],
        injured,
      });
      expect(moves[i]!.key).toBe(moveKey(o));
      expect(applyMove(wire, 1, moves[i]!)).toEqual(toWire(full.input));
    }
    // The IR return cuts someone on Jack's roster in every move.
    expect(moves.every((m) => m.teams![0]!.irCut != null)).toBe(true);
  });
});

describe("the moves a job checks", () => {
  const add = (id: number) => p(id, "C", 20);
  const opts = (addId: number, drops: number[], net: number) =>
    drops.map(
      (d, i) => ({ ...option(add(addId), p(d, "C", 10)), netWins: net - i * 0.01 }) as StreamOption,
    );
  // 10 adds with 4 drops each; the first 9 are "best" (positive), add 10 only evaluated.
  const dropOptions = new Map(
    Array.from({ length: 10 }, (_, a) => [500 + a, opts(500 + a, [1, 2, 3, 4], 0.5 - a * 0.05)]),
  );
  const best = [...dropOptions.values()].slice(0, 9).map((o) => o[0]!);

  it("puts each card's opening move first, then every drop on the page, then the others' best", () => {
    const { options, leading } = jobMoveOptions({ best, thisWeek: [], dropOptions }, ["509:3:"]);
    const keys = options.map(moveKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("509:3:"); // asked for
    expect(keys.slice(1, 9)).toEqual(best.slice(0, 8).map(moveKey)); // the 8 cards
    // + the top 15 by the estimate (all of adds 500-502, three of 503), less the 4 on cards.
    expect(leading).toBe(1 + 8 + 15 - 4);
    // Every drop of the 8 shown adds; the 9th and 10th adds get their best 3.
    for (let a = 0; a < 8; a++)
      for (const d of [1, 2, 3, 4]) expect(keys).toContain(`${500 + a}:${d}:`);
    expect(keys.filter((k) => k.startsWith("509:")).sort()).toEqual(["509:1:", "509:2:", "509:3:"]);
    expect(keys).not.toContain("509:4:");
  });

  it("splits keys into groups of 12 in order", () => {
    const g = groupsOf(Array.from({ length: 30 }, (_, i) => `k${i}`));
    expect(g.map((x) => x.length)).toEqual([12, 12, 6]);
    expect(g[1]![0]).toBe("k12");
  });
});

describe("which group the next chunks go to", () => {
  const g = (
    grp: number,
    prio: number,
    next: number,
    posted: number,
    active = ["a"],
  ): SimGroup => ({
    grp,
    prio,
    active,
    next_chunk: next,
    posted,
  });

  it("fills the opening groups to the minimum first, then the others a few at a time", () => {
    expect(pickGroup([g(0, 1, 0, 0), g(1, 2, 0, 0)], 100, 40, 20)!.grp).toBe(0);
    expect(pickGroup([g(0, 1, 20, 0), g(1, 2, 0, 0)], 100, 40, 20)!.grp).toBe(1);
    expect(pickGroup([g(0, 1, 20, 0), g(1, 2, 6, 0), g(2, 2, 0, 0)], 100, 40, 20)!.grp).toBe(2);
  });

  it("lets a group run further ahead as its results come in", () => {
    expect(pickGroup([g(0, 1, 50, 30), g(1, 2, 0, 0)], 100, 40, 20)!.grp).toBe(0);
    expect(pickGroup([g(0, 1, 62, 30), g(1, 2, 0, 0)], 100, 40, 20)!.grp).toBe(1);
  });

  it("puts asked-for moves ahead, gives idle runners to the top group, and stops when done", () => {
    expect(pickGroup([g(0, 1, 0, 0), g(1, 0, 0, 0)], 100, 40, 20)!.grp).toBe(1);
    expect(pickGroup([g(0, 1, 20, 0), g(1, 2, 6, 0)], 100, 40, 20)!.grp).toBe(0);
    expect(pickGroup([g(0, 1, 40, 40, []), g(1, 2, 100, 100)], 100, 40, 20)).toBeNull();
    // Group 0 carries the base run to its minimum even with no moves left.
    expect(pickGroup([g(0, 1, 30, 30, [])], 100, 40, 20)!.grp).toBe(0);
  });
});
