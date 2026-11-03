import { describe, expect, it } from "vitest";
import type { ChunkResult } from "@fantasy-copilot/fantasy-core";
import { combine, combineOutlook, needsMore, MAX_SEASONS, MIN_SEASONS } from "@/lib/nba/deep-check";

// Synthetic chunks: per-season title differences with a known mean and spread.
function chunk(
  i: number,
  moves: Record<string, { mean: number; sd: number }>,
  n = 200,
): ChunkResult {
  const sums = (mean: number, sd: number) => {
    // n seasons alternating mean±sd (+ a small per-chunk wobble): exact mean and variance.
    const wobble = ((i * 37) % 7) / 1000 - 0.003;
    const xs = Array.from({ length: n }, (_, k) => mean + wobble + (k % 2 ? sd : -sd));
    return { n, sum: xs.reduce((a, x) => a + x, 0), sumsq: xs.reduce((a, x) => a + x * x, 0) };
  };
  return {
    chunk: i,
    seasons: n,
    outlook: [
      {
        teamId: 1,
        expWins: 10,
        expPointsFor: 1000,
        playoffs: 0.5,
        seed1: 0.1,
        final: 0.2,
        champ: 0.1,
      },
    ],
    base: { title: 0.15 * n, playoffs: 0.9 * n, seed1: 0.3 * n, bye: 0.5 * n, wins: 12 * n },
    moves: Object.fromEntries(
      Object.entries(moves).map(([k, { mean, sd }]) => [
        k,
        {
          title: sums(mean, sd),
          playoffs: sums(0, 0.1),
          seed1: sums(0, 0.1),
          bye: sums(0, 0.1),
          wins: sums(mean * 10, sd * 10),
        },
      ]),
    ),
  };
}

describe("deep move checks", () => {
  it("combines chunks into a paired mean and standard error", () => {
    const chunks = Array.from({ length: 20 }, (_, i) => chunk(i, { a: { mean: 0.02, sd: 0.1 } }));
    const [a] = combine(chunks, ["a"]);
    expect(a!.seasons).toBe(4000);
    expect(a!.title.d).toBeCloseTo(0.02, 3);
    expect(a!.title.se).toBeCloseTo(0.1 / Math.sqrt(4000), 3);
    expect(a!.pBetter).toBeGreaterThan(0.99);
  });

  it("keeps going until ±0.5 points or the cap, and drops clearly worse moves", () => {
    const d = (x: number, se: number) => ({ d: x, se });
    expect(needsMore({ seasons: 1000, title: d(0, 0.001), wins: d(0, 0.01) }).more).toBe(true); // too few
    expect(needsMore({ seasons: MIN_SEASONS, title: d(0.01, 0.003), wins: d(0, 0.01) }).more).toBe(
      true,
    ); // ±0.6
    expect(needsMore({ seasons: MIN_SEASONS, title: d(0.01, 0.002), wins: d(0, 0.01) }).more).toBe(
      false,
    ); // ±0.4
    expect(needsMore({ seasons: MAX_SEASONS, title: d(0, 0.01), wins: d(0, 0.1) }).more).toBe(
      false,
    );
    expect(needsMore({ seasons: MIN_SEASONS, title: d(-0.03, 0.005), wins: d(-0.5, 0.1) })).toEqual(
      {
        more: false,
        dropped: true,
      },
    );
  });

  it("names the best move most of the time when one is clearly better", () => {
    const chunks = Array.from({ length: 30 }, (_, i) =>
      chunk(i, { good: { mean: 0.03, sd: 0.1 }, meh: { mean: 0.0, sd: 0.1 } }),
    );
    const [good, meh] = combine(chunks, ["good", "meh"]);
    expect(good!.pBest!).toBeGreaterThan(0.95);
    expect(meh!.pBest!).toBeLessThan(0.05);
  });

  it("averages the Outlook over chunks by seasons", () => {
    const out = combineOutlook([chunk(0, {}, 100), chunk(1, {}, 300)]);
    expect(out[0]!.champ).toBeCloseTo(0.1, 9);
  });
});
