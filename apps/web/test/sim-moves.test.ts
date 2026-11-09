import { describe, expect, it } from "vitest";
import type { FantasyTeam, Matchup, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { applyMove, toWire } from "@fantasy-copilot/fantasy-core";
import { buildOutlookInput } from "@/lib/nba/outlook";
import { applyTrade, valueContext } from "@/lib/nba/trade";
import {
  buildTradeMoves,
  buildWireMoves,
  groupsOf,
  jobMoveOptions,
  moveKey,
  pickGroup,
  tradeKey,
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
  ties: 0,
  pointsFor: 0,
  activity: null,
  roster,
  watchList: [],
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

  it("never mixes top-tier moves with the rest in a group (ADR-060)", () => {
    const g = groupsOf(
      Array.from({ length: 30 }, (_, i) => `k${i}`),
      14,
    );
    expect(g.map((x) => x.length)).toEqual([12, 2, 12, 4]);
    expect(g[2]![0]).toBe("k14");
  });

  it("checks watched free agents' opening moves to the top tier, with all their drops", () => {
    const watched = [opts(509, [1, 2, 3, 4], 0.05)[0]!];
    const { options, top } = jobMoveOptions({ best, thisWeek: [], dropOptions, watched });
    const keys = options.map(moveKey);
    expect(keys.slice(0, top)).toContain("509:1:");
    for (const d of [2, 3, 4]) expect(keys).toContain(`509:${d}:`);
  });

  it("checks streams' opening moves to the rest tier under the CPU saver", () => {
    const stream = { ...opts(509, [1], 0.05)[0]!, deltaWin: 0.02 } as StreamOption;
    const full = jobMoveOptions({ best, thisWeek: [stream], dropOptions });
    expect(full.options.map(moveKey).slice(0, full.top)).toContain("509:1:");
    const light = jobMoveOptions({ best, thisWeek: [stream], dropOptions }, [], false);
    const keys = light.options.map(moveKey);
    expect(keys.slice(0, light.top)).not.toContain("509:1:");
    expect(keys.slice(light.top, light.leading)).toContain("509:1:");
  });

  it("checks the cards' opening moves (and asked-for ones) to the top tier", () => {
    const { top, leading } = jobMoveOptions({ best, thisWeek: [], dropOptions }, ["509:3:"]);
    // The asked-for move and the 8 cards' opening moves; the best-by-estimate are rest tier.
    expect(top).toBe(9);
    expect(leading).toBeGreaterThan(top);
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
    n_active: active.length,
    next_chunk: next,
    posted,
    min_chunks: 20,
    max_chunks: 100,
  });

  it("fills the opening groups to the minimum first, then the others a few at a time", () => {
    expect(pickGroup([g(0, 1, 0, 0), g(1, 2, 0, 0)], 40)!.grp).toBe(0);
    expect(pickGroup([g(0, 1, 20, 0), g(1, 2, 0, 0)], 40)!.grp).toBe(1);
    expect(pickGroup([g(0, 1, 20, 0), g(1, 2, 6, 0), g(2, 2, 0, 0)], 40)!.grp).toBe(2);
  });

  it("lets a group run further ahead as its results come in", () => {
    expect(pickGroup([g(0, 1, 50, 30), g(1, 2, 0, 0)], 40)!.grp).toBe(0);
    expect(pickGroup([g(0, 1, 62, 30), g(1, 2, 0, 0)], 40)!.grp).toBe(1);
  });

  it("caps each group at its own tier's limit", () => {
    const rest = { ...g(1, 2, 30, 30), max_chunks: 30 };
    expect(pickGroup([g(0, 1, 100, 100, []), rest], 40)).toBeNull();
    expect(pickGroup([g(0, 1, 100, 100, []), { ...rest, next_chunk: 29 }], 40)!.grp).toBe(1);
  });

  it("puts asked-for moves ahead, gives idle runners to the top group, and stops when done", () => {
    expect(pickGroup([g(0, 1, 0, 0), g(1, 0, 0, 0)], 40)!.grp).toBe(1);
    expect(pickGroup([g(0, 1, 20, 0), g(1, 2, 6, 0)], 40)!.grp).toBe(0);
    expect(pickGroup([g(0, 1, 40, 40, []), g(1, 2, 100, 100)], 40)).toBeNull();
    // Group 0 carries the base run to its minimum even with no moves left.
    expect(pickGroup([g(0, 1, 30, 30, [])], 40)!.grp).toBe(0);
  });
});

describe("trade ideas built as patches on the base season", () => {
  it("equal the season rebuilt with both rosters (and pickups and cuts) as the trade leaves them", () => {
    const base = buildOutlookInput({ ...args, teams, freeAgents, injured });
    const wire = toWire(base.input);
    const ctx = valueContext(games, SLOTS, 1, 20, 2, injured);
    // 2-for-1: Jack's side picks up a free agent, theirs has to cut someone.
    const theirsBefore = teams[1]!.roster;
    const give = [mine[1]!, mine[3]!];
    const get = [theirsBefore[0]!];
    const taken = new Set<number>();
    const m = applyTrade(mine, give, get, ctx, freeAgents, taken);
    const t = applyTrade(theirsBefore, get, give, ctx, freeAgents, taken);
    expect(m.moves.added.length + t.moves.dropped.length).toBeGreaterThan(0);
    const ids = (ps: { id: number }[]) => ps.map((p) => p.id);
    const spec = {
      partnerId: 2,
      give: ids(give),
      get: ids(get),
      moves: {
        mine: { dropped: ids(m.moves.dropped), added: ids(m.moves.added), toIL: ids(m.moves.toIL) },
        theirs: {
          dropped: ids(t.moves.dropped),
          added: ids(t.moves.added),
          toIL: ids(t.moves.toIL),
        },
      },
    };
    const [move] = buildTradeMoves(
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
        teams,
      },
      [spec],
    );
    const added = new Set([...spec.moves.mine.added, ...spec.moves.theirs.added]);
    const full = buildOutlookInput({
      ...args,
      teams: teams.map((x) =>
        x.id === 1 ? { ...x, roster: m.roster } : x.id === 2 ? { ...x, roster: t.roster } : x,
      ),
      freeAgents: [
        ...freeAgents.filter((f) => !added.has(f.id)),
        ...m.moves.dropped,
        ...t.moves.dropped,
      ],
      injured,
    });
    expect(move!.key).toBe(tradeKey(2, spec.give, spec.get));
    expect(applyMove(wire, 1, move!)).toEqual(toWire(full.input));
  });
});
