import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { dateForScoringPeriod } from "@/lib/nba/calendar";
import {
  absencesByGame,
  contextFactor,
  factorDays,
  factorOn,
  outUntilFor,
  pastAdjustments,
  regularsNow,
  withContext,
  type Appearance,
  type ContextPayload,
  type PlayerContext,
} from "@/lib/nba/context";
import { perGameProjection } from "@/lib/nba/projection";

// Synthetic (not real data): team "AAA" plays games 1-12 on days 1-12. Player 1 is its star
// (30 minutes, 40 FP), out for games 11-12; players 2-5 play every game (25 minutes, 15 FP).
const day = 86_400_000;
const games = (id: number, nums: number[], min: number, fp: number) =>
  nums.map((n) => ({ side: `${n}:AAA`, game: n, team: "AAA", t: n * day, fp, min }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const logs = new Map<number, (Appearance & { game: number })[]>([
  [1, games(1, range(1, 10), 30, 40)],
  ...[2, 3, 4, 5].map(
    (id) => [id, games(id, range(1, 12), 25, 15)] as [number, ReturnType<typeof games>],
  ),
]);
const groupOf = (id: number) => (id === 1 || id === 2 ? "C" : "G");

describe("the context-aware projection's pieces", () => {
  it("finds the star absent, with his share of the team's points and how long he's been out", () => {
    const absent = absencesByGame(logs, groupOf);
    // Team FP per game over games 1-10: 40 + 4 × 15 = 100, so his share is 0.4.
    expect(absent.get("11:AAA")).toEqual([{ share: 0.4, idx: 1, group: "C", min10: 30 }]);
    // Game 12's last 10 team games (2-11) include game 11 without him: 960 / 10 = 96.
    expect(absent.get("12:AAA")).toEqual([{ share: 40 / 96, idx: 2, group: "C", min10: 30 }]);
    expect(absent.get("10:AAA")).toEqual([]);
  });

  it("weighs his share above the floor, doubled for his position group", () => {
    const star = [{ share: 0.4, idx: 1, group: "C", min10: 30 }];
    expect(contextFactor(star, "G")).toBeCloseTo(1 + 0.75 * 0.3);
    expect(contextFactor(star, "C")).toBeCloseTo(1 + 0.75 * 0.6);
    // Not a regular (under 20 minutes), or under the floor: no effect.
    expect(contextFactor([{ ...star[0]!, min10: 15 }], "C")).toBe(1);
    expect(contextFactor([{ ...star[0]!, share: 0.08 }], "C")).toBe(1);
  });

  it("takes the boosted part out of the games he missed", () => {
    const adj = pastAdjustments(logs, absencesByGame(logs, groupOf), groupOf);
    const at = (share: number) => 1 + 0.75 * Math.min(0.6, 2 * (share - 0.1));
    const lose = (game: number, x: number) => ({
      game,
      factor: x,
      fp: 15 * (1 - 1 / x),
      min: 25 * (1 - 1 / x),
    });
    expect(adj.get(2)).toEqual([lose(11, at(0.4)), lose(12, at(40 / 96))]);
    expect(adj.has(1)).toBe(false);
  });

  it("lists each team's rotation now, the star included while he's out", () => {
    const regs = regularsNow(logs, groupOf, 13 * day).get("AAA")!;
    // Team FP per game over games 3-12: games 3-10 have 100, games 11-12 have 60.
    const teamFp = (8 * 100 + 2 * 60) / 10;
    expect(regs.find((r) => r.player === 1)).toEqual({
      player: 1,
      share: 40 / teamFp,
      group: "C",
      min10: 30,
    });
    expect(regs.map((r) => r.player).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("the context-aware projection in production", () => {
  // Synthetic (not real data): a center projected 20 FP/G in 25 minutes, 12 games played.
  const pts = [18, 20, 22, 19, 21, 30, 32, 31, 20, 19, 21, 22];
  const mins = [24, 25, 26, 24, 25, 33, 34, 32, 25, 24, 26, 25];
  const player = (points = pts, minutes = mins): RosterPlayer => ({
    id: 2,
    name: "Test Backup",
    proTeamId: 18,
    proTeam: "NY",
    positions: ["C"],
    defaultPosition: "C",
    slot: "BE",
    injuryStatus: "ACTIVE",
    percentOwned: 0,
    percentChange: 0,
    projection: { avg: 20, total: 1400, stats: { MIN: 25 } },
    season: {
      avg: points.reduce((a, b) => a + b, 0) / points.length,
      total: points.reduce((a, b) => a + b, 0),
      stats: { MIN: minutes.reduce((a, b) => a + b, 0) / minutes.length },
    },
    last7: null,
    last15: null,
    last30: null,
    games: points.map((p, i) => ({
      gameId: 100 + i,
      scoringPeriodId: i + 1,
      points: p,
      line: { MIN: minutes[i]! },
    })),
  });

  it("projects from his games at full strength: as if those games had been smaller", () => {
    // Games 6-8 came with the starter out: factor 1.5.
    const x = 1.5;
    const adj = [5, 6, 7].map(
      (i) => [100 + i, i + 1, x, pts[i]! * (1 - 1 / x), mins[i]! * (1 - 1 / x)] as const,
    );
    const withContext = {
      ...player(),
      context: { adj: adj.map((a) => [...a]) as PlayerContext["adj"], days: [] },
    };
    const smaller = player(
      pts.map((p, i) => (i >= 5 && i <= 7 ? p / x : p)),
      mins.map((m, i) => (i >= 5 && i <= 7 ? m / x : m)),
    );
    expect(perGameProjection(withContext).fppg).toBeCloseTo(perGameProjection(smaller).fppg, 10);
    // As of game 7's day, only the games before it are adjusted.
    expect(perGameProjection(withContext, 7).fppg).toBeCloseTo(
      perGameProjection(smaller, 7).fppg,
      10,
    );
    expect(perGameProjection(withContext).fppg).toBeLessThan(perGameProjection(player()).fppg);
  });

  const regulars = [
    { player: 1, share: 0.4, group: "C", min10: 30, name: "Test Star" },
    { player: 3, share: 0.2, group: "G", min10: 25, name: "Test Wing" },
    { player: 4, share: 0.3, group: "G", min10: 15, name: "Test Sixth" },
  ];

  it("sets his factor from each day on by who's out and until when", () => {
    const until = new Map<number, number | null>([
      [1, 30],
      [3, Infinity],
      [4, 40],
    ]);
    const days = factorDays(2, "C", regulars, (id) => until.get(id) ?? null, 20);
    // Both out: 2 × (0.4 − 0.1) + (0.2 − 0.1), capped at 0.6; then the wing alone. The sixth
    // man (under 20 minutes) never counts.
    expect(days).toEqual([
      { day: 20, factor: 1 + 0.75 * 0.6, out: ["Test Star", "Test Wing"] },
      { day: 30, factor: 1 + 0.75 * 0.1, out: ["Test Wing"] },
    ]);
    const p = { context: { adj: [], days } };
    expect(factorOn(p, 19)).toBe(1);
    expect(factorOn(p, 25)).toBeCloseTo(1.45);
    expect(factorOn(p, 31)).toBeCloseTo(1.075);
    expect(factorDays(2, "C", regulars, () => null, 20)).toEqual([{ day: 20, factor: 1, out: [] }]);
  });

  it("reads who's out from ESPN's injury feed and NBA.com's inactive list", () => {
    const today = 20;
    const payload: ContextPayload = { asOf: today, adj: {}, regulars: { "18": regulars } };
    const outUntil = outUntilFor(payload, {
      injuries: [
        { playerId: 1, status: "Out", returnDate: dateForScoringPeriod(30) },
        { playerId: 4, status: "Day-To-Day", returnDate: null },
      ],
      lineups: [
        {
          nbaPersonId: 9,
          name: "Test Wing",
          team: "NYK",
          gameId: "x",
          lineupStatus: "Confirmed",
          rosterStatus: "Inactive",
          position: "",
          starter: false,
          timestamp: null,
        },
      ],
      players: [],
      today,
    });
    expect(outUntil(1)).toBe(30);
    expect(outUntil(3)).toBe(today + 1);
    expect(outUntil(4)).toBeNull();
    expect(outUntil(99)).toBeNull();
  });

  it("attaches a context only to players it changes, and nothing without one", () => {
    const players = [player(), { ...player(), id: 5, proTeamId: 20 }];
    expect(withContext(players, null, () => 30, 20)).toBe(players);
    const payload: ContextPayload = {
      asOf: 20,
      adj: { "2": [[105, 6, 1.5, 10, 11]] },
      regulars: { "18": regulars },
    };
    const [backup, other] = withContext(players, payload, (id) => (id === 1 ? 30 : null), 20);
    expect(backup!.context?.adj).toEqual([[105, 6, 1.5, 10, 11]]);
    expect(backup!.context?.days[0]).toMatchObject({ day: 20, out: ["Test Star"] });
    expect(other).toBe(players[1]);
  });
});
