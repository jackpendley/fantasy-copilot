import { describe, expect, it } from "vitest";
import {
  gamesMissed,
  oddsAroundMove,
  pointsBetween,
  stintEnds,
  type RunOdds,
} from "@/lib/nba/move-impact";

// Synthetic runs, games and moves (not real data).
const H = 3600_000;
const run = (runAt: number, champ: number): RunOdds => ({
  runAt,
  teams: new Map([[1, { champ, playoffs: champ * 4, expWins: champ * 50 }]]),
});

describe("odds around a move", () => {
  const runs = [run(0, 0.1), run(10 * H, 0.12), run(11 * H, 0.15), run(40 * H, 0.2)];

  it("compares the runs just before and after it", () => {
    const r = oddsAroundMove(runs, 1, 10.5 * H, [10.5 * H])!;
    expect(r.before).toBe(10 * H);
    expect(r.after).toBe(11 * H);
    expect(r.champ).toBeCloseTo(0.03, 10);
    expect(r.clean).toBe(true);
  });

  it("isn't clean when another move fell between, or the runs are far apart", () => {
    expect(oddsAroundMove(runs, 1, 10.5 * H, [10.5 * H, 10.7 * H])!.clean).toBe(false);
    expect(oddsAroundMove(runs, 1, 20 * H, [20 * H])!.clean).toBe(false);
  });

  it("is unknown without a run on both sides", () => {
    expect(oddsAroundMove(runs, 1, 50 * H, [])).toBeNull();
    expect(oddsAroundMove(runs, 2, 10.5 * H, [])).toBeNull();
  });
});

describe("points after a move", () => {
  const games = [
    { tip: 1 * H, fp: 10, minutes: 20 },
    { tip: 5 * H, fp: 20, minutes: 30 },
    { tip: 9 * H, fp: 0, minutes: 0 },
    { tip: 12 * H, fp: 30, minutes: 25 },
  ];

  it("counts games played that tipped after the move and before he left", () => {
    expect(pointsBetween(games, 2 * H)).toEqual({ points: 50, games: 2 });
    expect(pointsBetween(games, 2 * H, 10 * H)).toEqual({ points: 20, games: 1 });
  });

  it("counts his team's games he sat out", () => {
    const team = [1, 5, 9, 12].map((h, i) => ({ gameId: 100 + i, tip: h * H }));
    expect(gamesMissed(team, [100, 103], 0, 20 * H)).toBe(2);
    expect(gamesMissed(team, [], 4 * H, 8 * H)).toBe(1);
  });

  it("ends an added player's stint at his next drop by the same team", () => {
    const moves = [
      { teamId: 1, at: 1, adds: [7], drops: [8] },
      { teamId: 2, at: 2, adds: [8], drops: [] },
      { teamId: 1, at: 3, adds: [9], drops: [7] },
    ];
    const ends = stintEnds(moves);
    expect(ends.get("0:7")).toBe(3);
    expect(ends.get("1:8")).toBe(Infinity);
    expect(ends.get("2:9")).toBe(Infinity);
  });
});
