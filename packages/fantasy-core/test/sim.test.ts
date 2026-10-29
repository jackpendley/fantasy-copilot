import { describe, expect, it } from "vitest";
import {
  keyedUniform,
  simulateSeason,
  simulateSeasonAsync,
  type SimInput,
  type SimPlayer,
  type SimTeam,
} from "../src/sim";
import type { Position } from "../src/slots";

// Synthetic 8-team league (not real data): 12-man rosters, every pro team plays every other
// day, 6-day weeks, 6 regular weeks + 3 playoff weeks, round-robin schedule.
const SLOTS = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 2, BE: 3, IR: 1 };
const POS: Position[][] = [
  ["PG"],
  ["SG"],
  ["SF"],
  ["PF"],
  ["C"],
  ["PG", "SG"],
  ["SF", "PF"],
  ["C"],
];
const DAYS_PER_WEEK = 6;
const WEEKS = 9;
const LAST_DAY = DAYS_PER_WEEK * WEEKS;

function team(id: number, fppg: number, act = 1): SimTeam {
  const roster: SimPlayer[] = Array.from({ length: 12 }, (_, i) => ({
    id: id * 100 + i,
    eligible: POS[i % POS.length]!,
    proTeamId: (i % 6) + 1,
    fppg: fppg - i * 0.5,
    gp: 72,
    sd: 0.1,
  }));
  return { id, roster, act, addsPerWeek: 0.5 };
}

function league(teams: SimTeam[], extra: Partial<SimInput> = {}): SimInput {
  const ids = teams.map((t) => t.id);
  const matchups: SimInput["matchups"] = [];
  for (let w = 1; w <= 6; w++) {
    const rot = [ids[0]!, ...ids.slice(1).map((_, k) => ids[1 + ((k + w) % (ids.length - 1))]!)];
    for (let k = 0; k < ids.length / 2; k++)
      matchups.push({ period: w, home: rot[k]!, away: rot[ids.length - 1 - k]!, winner: null });
  }
  const gameDays = new Map<number, Set<number>>();
  for (let pro = 1; pro <= 6; pro++) {
    const days = new Set<number>();
    for (let d = 1 + (pro % 2); d <= LAST_DAY; d += 2) days.add(d);
    gameDays.set(pro, days);
  }
  return {
    teams,
    freeAgents: [],
    slotCounts: SLOTS,
    gameDays,
    periodOf: (d) => Math.ceil(d / DAYS_PER_WEEK),
    fromDay: 1,
    lastDay: LAST_DAY,
    matchups,
    regularWeeks: 6,
    banked: new Map(),
    playoffWeeks: [7, 8, 9],
    addCapPerWeek: 3,
    seasons: 400,
    seed: 7,
    ...extra,
  };
}

// Full simulations: CI machines can take several seconds per test.
describe("simulateSeason", { timeout: 30_000 }, () => {
  const teams = [team(1, 40), ...[2, 3, 4, 5, 6, 7, 8].map((id) => team(id, 30))];

  it("returns probabilities that add up (6 playoff spots, 1 champion)", () => {
    const res = simulateSeason(league(teams));
    const sum = (k: keyof (typeof res)[number]) => res.reduce((a, r) => a + (r[k] as number), 0);
    expect(sum("playoffs")).toBeCloseTo(6, 6);
    expect(sum("seed1")).toBeCloseTo(1, 6);
    expect(sum("final")).toBeCloseTo(2, 6);
    expect(sum("champ")).toBeCloseTo(1, 6);
    expect(sum("expWins")).toBeCloseTo(6 * 4, 6); // 4 games per week, 6 weeks
  });

  it("gives identical results when run in slices (async) and lets other work run meanwhile", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const small = league(teams, { seasons: 100 });
    const sliced = await simulateSeasonAsync(small, 0);
    clearInterval(timer);
    expect(sliced).toEqual(simulateSeason(small));
    expect(ticks).toBeGreaterThan(0);
  });

  it("makes the much stronger team the favorite", () => {
    const res = simulateSeason(league(teams));
    const best = res.find((r) => r.teamId === 1)!;
    for (const r of res) if (r.teamId !== 1) expect(best.champ).toBeGreaterThan(r.champ);
    expect(best.playoffs).toBeGreaterThan(0.95);
  });

  it("penalizes an inactive manager with the same roster", () => {
    const even = [team(1, 30, 0.1), ...[2, 3, 4, 5, 6, 7, 8].map((id) => team(id, 30))];
    const res = simulateSeason(league(even));
    const lazy = res.find((r) => r.teamId === 1)!;
    const avgOthers = res.filter((r) => r.teamId !== 1).reduce((a, r) => a + r.expWins, 0) / 7;
    expect(lazy.expWins).toBeLessThan(avgOthers - 0.5);
  });

  it("keeps decided weeks: a team that already lost every week can't get those wins back", () => {
    const base = league(teams);
    const decided = base.matchups.map((m) =>
      m.period <= 5
        ? {
            ...m,
            winner: (m.home === 1 ? "AWAY" : m.away === 1 ? "HOME" : "HOME") as "HOME" | "AWAY",
          }
        : m,
    );
    const res = simulateSeason({ ...base, matchups: decided, fromDay: 5 * DAYS_PER_WEEK + 1 });
    const t1 = res.find((r) => r.teamId === 1)!;
    expect(t1.expWins).toBeLessThanOrEqual(1);
  });

  it("is reproducible with a seed", () => {
    expect(simulateSeason(league(teams))).toEqual(simulateSeason(league(teams)));
  });
});

describe("common random numbers", () => {
  it("keyed draws are uniform and differ by key", () => {
    const bins = new Array(10).fill(0);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const u = keyedUniform(7, [i, 3]);
      sum += u;
      bins[Math.floor(u * 10)]++;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 2);
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
    expect(keyedUniform(7, [1, 2])).not.toBe(keyedUniform(7, [2, 1]));
    expect(keyedUniform(7, [1, 2])).toBe(keyedUniform(7, [1, 2]));
  });

  it("adding a player who never plays leaves every team's odds exactly unchanged", () => {
    // With one sequential random stream, his extra draws shifted everyone else's luck.
    const teams = [8, 7.5, 7, 7, 6.5, 6, 6, 5.5].map((f, i) => team(i + 1, 20 + f));
    const base = simulateSeason(league(teams));
    const changed = teams.map((t) =>
      t.id === 8
        ? {
            ...t,
            roster: [
              ...t.roster,
              { id: 9999, eligible: ["C"] as Position[], proTeamId: 99, fppg: 1, gp: 72, sd: 0.1 },
            ],
          }
        : t,
    );
    expect(simulateSeason(league(changed))).toEqual(base);
  });
});

describe("known injuries", { timeout: 30_000 }, () => {
  const base = () => [team(1, 40), ...[2, 3, 4, 5, 6, 7, 8].map((id) => team(id, 30))];
  // Fewer seasons than the other tests: three full simulations per test on slow CI machines.
  const pointsOf = (input: SimInput, id = 1) =>
    simulateSeason({ ...input, seasons: 150 }).find((r) => r.teamId === id)!.expPointsFor;

  it("a star out for the season scores less than one back mid-season, who scores less than healthy", () => {
    const healthy = pointsOf(league(base()));
    const hurt = (outUntil: number) => {
      const teams = base();
      teams[0]!.roster = teams[0]!.roster.map((p, i) => (i < 3 ? { ...p, outUntil } : p));
      return pointsOf(league(teams));
    };
    const back = hurt(25);
    const season = hurt(LAST_DAY + 1);
    expect(back).toBeLessThan(healthy);
    expect(season).toBeLessThan(back);
  });

  it("an IR-slot player returns when healthy (instead of staying on IR forever)", () => {
    // Team 1's best player sits in the IR slot until day 10 vs being gone entirely.
    const withReserve = base();
    const star = { ...withReserve[0]!.roster[0]!, outUntil: 10, reserve: true };
    withReserve[0]!.roster = [star, ...withReserve[0]!.roster.slice(1)];
    const without = base();
    without[0]!.roster = without[0]!.roster.slice(1);
    expect(pointsOf(league(withReserve))).toBeGreaterThan(pointsOf(league(without)) + 50);
  });
});

// Exactness guard: every path (streaming, IR stashes, known injuries, a reserve, lazy managers,
// banked and decided weeks) on a synthetic league, against results recorded from the simulator
// before its 2026-10-29 speed rewrite. Any change to the draws or tie-breaks shows up here.
const GOLDEN_SLOTS = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 2, BE: 3, IR: 1 };
function goldenInput(): SimInput {
  const teams: SimTeam[] = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({
    id,
    act: id % 3 === 0 ? 0.6 : 1,
    addsPerWeek: id % 4 === 0 ? 0.1 : 1.5,
    roster: Array.from({ length: 12 }, (_, i): SimPlayer => ({
      id: id * 100 + i,
      eligible: POS[i % POS.length]!,
      proTeamId: ((id + i) % 6) + 1,
      fppg: 34 - i * 1.5 + (id % 3),
      gp: 60 + ((id * 7 + i * 3) % 22),
      sd: 0.12,
      ...(i === 2 && id % 2 === 0 ? { outUntil: 9 } : {}),
      ...(i === 11 && id === 3 ? { reserve: true, outUntil: 14 } : {}),
    })),
  }));
  const freeAgents: SimPlayer[] = Array.from({ length: 20 }, (_, i) => ({
    id: 5000 + i,
    eligible: POS[i % POS.length]!,
    proTeamId: (i % 6) + 1,
    fppg: 22 - i * 0.6,
    gp: 70,
    sd: 0.15,
  }));
  const ids = teams.map((t) => t.id);
  const matchups: SimInput["matchups"] = [];
  for (let w = 1; w <= 6; w++) {
    const rot = [ids[0]!, ...ids.slice(1).map((_, k) => ids[1 + ((k + w) % (ids.length - 1))]!)];
    for (let k = 0; k < ids.length / 2; k++)
      matchups.push({
        period: w,
        home: rot[k]!,
        away: rot[ids.length - 1 - k]!,
        winner: w === 1 ? "HOME" : null,
      });
  }
  const gameDays = new Map<number, Set<number>>();
  for (let pro = 1; pro <= 6; pro++) {
    const days = new Set<number>();
    for (let d = 1 + (pro % 2); d <= 63; d += pro === 3 ? 1 : 2) days.add(d);
    gameDays.set(pro, days);
  }
  return {
    teams,
    freeAgents,
    slotCounts: GOLDEN_SLOTS,
    gameDays,
    periodOf: (d) => Math.ceil(d / 7),
    fromDay: 4,
    lastDay: 63,
    matchups,
    regularWeeks: 6,
    banked: new Map([
      [
        1,
        new Map([
          [1, 400],
          [2, 120],
        ]),
      ],
      [
        2,
        new Map([
          [1, 380],
          [2, 140],
        ]),
      ],
    ]),
    playoffWeeks: [7, 8, 9],
    addCapPerWeek: 3,
    seasons: 60,
    seed: 99,
  };
}

const GOLDEN = [
  {
    teamId: 1,
    expWins: 4.05,
    expPointsFor: 7000.084472180561,
    playoffs: 1,
    seed1: 0.2,
    final: 0.18333333333333332,
    champ: 0.13333333333333333,
  },
  {
    teamId: 2,
    expWins: 3.7666666666666666,
    expPointsFor: 7457.789002314584,
    playoffs: 0.9833333333333333,
    seed1: 0.26666666666666666,
    final: 0.43333333333333335,
    champ: 0.2,
  },
  {
    teamId: 3,
    expWins: 2.15,
    expPointsFor: 5670.969519126381,
    playoffs: 0.43333333333333335,
    seed1: 0,
    final: 0.11666666666666667,
    champ: 0.05,
  },
  {
    teamId: 4,
    expWins: 3.6166666666666667,
    expPointsFor: 6631.486783924006,
    playoffs: 0.8833333333333333,
    seed1: 0.15,
    final: 0.31666666666666665,
    champ: 0.16666666666666666,
  },
  {
    teamId: 5,
    expWins: 3.6,
    expPointsFor: 6721.094945637409,
    playoffs: 0.9333333333333333,
    seed1: 0.15,
    final: 0.3333333333333333,
    champ: 0.2,
  },
  {
    teamId: 6,
    expWins: 0.9833333333333333,
    expPointsFor: 5449.806150256776,
    playoffs: 0.15,
    seed1: 0,
    final: 0.05,
    champ: 0,
  },
  {
    teamId: 7,
    expWins: 2.7333333333333334,
    expPointsFor: 6487.297239288487,
    playoffs: 0.7166666666666667,
    seed1: 0.08333333333333333,
    final: 0.26666666666666666,
    champ: 0.11666666666666667,
  },
  {
    teamId: 8,
    expWins: 3.1,
    expPointsFor: 6792.419732415116,
    playoffs: 0.9,
    seed1: 0.15,
    final: 0.3,
    champ: 0.13333333333333333,
  },
];

describe("simulator exactness", { timeout: 30_000 }, () => {
  it("matches the results recorded before the speed rewrite, to the last bit", () => {
    expect(simulateSeason(goldenInput())).toEqual(GOLDEN);
  });
});

describe("progress reports", { timeout: 30_000 }, () => {
  it("reports the odds so far, each exactly a shorter run of the same seasons", async () => {
    const reports: { done: number; partial: unknown }[] = [];
    const full = await simulateSeasonAsync(goldenInput(), 25, {
      every: 20,
      report: (partial, done) => {
        reports.push({ done, partial });
      },
    });
    expect(reports.map((r) => r.done)).toEqual([20, 40]);
    expect(reports[0]!.partial).toEqual(simulateSeason({ ...goldenInput(), seasons: 20 }));
    expect(reports[1]!.partial).toEqual(simulateSeason({ ...goldenInput(), seasons: 40 }));
    expect(full).toEqual(GOLDEN);
  });
});
