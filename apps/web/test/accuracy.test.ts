import { describe, expect, it } from "vitest";
import { accuracyBySource, bestProjection, evalRows, type ScoredGame } from "@/lib/nba/accuracy";

// Synthetic logged games.
const g = (
  day: string,
  ours: number | null,
  vegas: number | null,
  espn: number | null,
  actual: number,
  darko: number | null = null,
): ScoredGame => ({
  playerId: 1,
  day,
  ours,
  vegas,
  espn,
  darko,
  actual,
});

describe("bestProjection", () => {
  it("is ours until the blend ships, and the weighted blend for games with props after", () => {
    expect(bestProjection(30, 20, 0)).toBe(30);
    expect(bestProjection(30, null, 0.6)).toBe(30);
    expect(bestProjection(30, 20, 0.6)).toBeCloseTo(24);
  });
});

describe("accuracyBySource", () => {
  const games = [
    g("2026-10-27", 30, 26, 28, 25), // ours 5, vegas 1, espn 3
    g("2026-10-25", 20, null, 22, 30), // ours 10, espn 8 (no props)
    g("2026-10-01", 10, 14, null, 12), // 26 days ago: in 30, not in 7
  ];
  it("averages misses per source and window, Vegas only where it posted", () => {
    const a = accuracyBySource(games, 0, "2026-10-27");
    const by = Object.fromEntries(a.map((x) => [x.source, x]));
    expect(by.ours!.last7).toEqual({ games: 2, mae: 7.5 });
    expect(by.ours!.last30).toEqual({ games: 3, mae: (5 + 10 + 2) / 3 });
    expect(by.vegas!.last7).toEqual({ games: 1, mae: 1 });
    expect(by.espn!.season).toEqual({ games: 2, mae: 5.5 });
    // No blend row until it ships.
    expect(by.blend).toBeUndefined();
  });
  it("adds the blend once it has a weight", () => {
    const a = accuracyBySource(games, 0.5, "2026-10-27");
    const blend = a.find((x) => x.source === "blend")!;
    // Day 1: blend 28 vs 25 -> 3; Oct 1: blend 12 vs 12 -> 0.
    expect(blend.season).toEqual({ games: 2, mae: 1.5 });
  });
  it("feeds the props test only games with both projections", () => {
    expect(evalRows(games).map((r) => r.day)).toEqual(["2026-10-27", "2026-10-01"]);
  });
  it("scores DARKO only where it projected, and feeds its test the same way", () => {
    expect(accuracyBySource(games, 0, "2026-10-27").find((x) => x.source === "darko")).toBe(
      undefined,
    );
    const withDarko = [...games, g("2026-10-26", 18, null, null, 24, 21)];
    const darko = accuracyBySource(withDarko, 0, "2026-10-27").find((x) => x.source === "darko")!;
    expect(darko.season).toEqual({ games: 1, mae: 3 });
    expect(evalRows(withDarko, "darko")).toEqual([
      { playerId: 1, day: "2026-10-26", model: 18, vegas: 21, actual: 24 },
    ]);
  });
});
