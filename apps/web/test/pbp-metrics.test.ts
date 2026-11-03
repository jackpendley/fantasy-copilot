import { describe, expect, it } from "vitest";
import { distributions, percentileOf, playerMetrics, minGamesFor } from "@/lib/nba/pbp-metrics";

// Synthetic league (not real data): 10 regulars with rising turnovers and points.
const league = Array.from({ length: 10 }, (_, i) => ({
  GamesPlayed: 10,
  Minutes: 300,
  Points: 100 + i * 20,
  Turnovers: 10 + i * 5,
}));

describe("percentiles", () => {
  it("rank among regulars, ties counted half", () => {
    expect(percentileOf([1, 2, 3, 4], 3)).toBe(62.5);
    expect(percentileOf([], 3)).toBeNull();
    expect(minGamesFor([{ GamesPlayed: 6 }])).toBe(3);
  });

  it("make a high percentile always good: most turnovers is the bottom", () => {
    const dist = distributions(league);
    const top = playerMetrics(league[9]!, dist);
    const pts = top.find((m) => m.key === "pts36")!;
    const tov = top.find((m) => m.key === "tov36")!;
    expect(pts.percentile).toBe(95);
    expect(pts.tone).toBe("good");
    expect(tov.percentile).toBe(5);
    expect(tov.tone).toBe("bad");
  });

  it("aren't given to a player with too few minutes", () => {
    const dist = distributions(league);
    const cameo = playerMetrics({ GamesPlayed: 10, Minutes: 30, Points: 40 }, dist);
    expect(cameo.find((m) => m.key === "pts36")!.percentile).toBeNull();
    expect(cameo.find((m) => m.key === "pts36")!.tone).toBeNull();
  });
});
