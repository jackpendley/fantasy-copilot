import { describe, expect, it } from "vitest";
import type { ChunkResult } from "@fantasy-copilot/fantasy-core";
import {
  combine,
  combineOutlook,
  contendersOf,
  needsMore,
  EARLY_SEASONS,
  REST_TIER,
  TOP_TIER,
} from "@/lib/nba/deep-check";

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
        bye: 0.2,
        final: 0.2,
        champ: 0.1,
        champBye: 0.05,
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

  it("keeps going until its tier's precision or cap, and drops clearly worse moves", () => {
    const d = (x: number, se: number) => ({ d: x, se });
    const top = TOP_TIER;
    expect(needsMore({ seasons: 1000, title: d(0, 0.001), wins: d(0, 0.01) }).more).toBe(true); // too few
    // Top tier: ±0.35 title points.
    expect(
      needsMore({ seasons: top.minSeasons, title: d(0.01, 0.002), wins: d(0, 0.01) }).more,
    ).toBe(true); // ±0.4
    expect(
      needsMore({ seasons: top.minSeasons, title: d(0.01, 0.0017), wins: d(0, 0.01) }).more,
    ).toBe(false); // ±0.34
    expect(needsMore({ seasons: top.maxSeasons, title: d(0, 0.01), wins: d(0, 0.1) }).more).toBe(
      false,
    );
    expect(
      needsMore({ seasons: top.minSeasons, title: d(-0.03, 0.005), wins: d(-0.5, 0.1) }),
    ).toEqual({ more: false, dropped: true });
    // Rest tier: ±1 point, from 1,000 to 6,000 seasons.
    const rest = REST_TIER;
    expect(needsMore({ seasons: 1000, title: d(0.01, 0.004), wins: d(0, 0.01) }, rest).more).toBe(
      false,
    ); // ±0.8
    expect(needsMore({ seasons: 1000, title: d(0.01, 0.006), wins: d(0, 0.01) }, rest).more).toBe(
      true,
    ); // ±1.2
    expect(needsMore({ seasons: 6000, title: d(0, 0.01), wins: d(0, 0.1) }, rest).more).toBe(false);
    expect(needsMore({ seasons: 800, title: d(0, 0.001), wins: d(0, 0.01) }, rest).more).toBe(true);
  });

  it("names the best move most of the time when one is clearly better", () => {
    const chunks = Array.from({ length: 30 }, (_, i) =>
      chunk(i, { good: { mean: 0.03, sd: 0.1 }, meh: { mean: 0.0, sd: 0.1 } }),
    );
    const [good, meh] = combine(chunks, ["good", "meh"]);
    expect(good!.pBest!).toBeGreaterThan(0.95);
    expect(meh!.pBest!).toBeLessThan(0.05);
  });

  it("stops a clearly worse move after 1,000 seasons, a merely worse one only at the minimum", () => {
    const d = (x: number, se: number) => ({ d: x, se });
    // 5 SE worse on both: done.
    expect(needsMore({ seasons: EARLY_SEASONS, title: d(-0.05, 0.01), wins: d(-1, 0.2) })).toEqual({
      more: false,
      dropped: true,
    });
    // 3 SE worse: keeps going to the minimum; worse on title only: keeps going.
    expect(
      needsMore({ seasons: EARLY_SEASONS, title: d(-0.03, 0.01), wins: d(-0.6, 0.2) }).more,
    ).toBe(true);
    expect(needsMore({ seasons: EARLY_SEASONS, title: d(-0.05, 0.01), wins: d(0, 0.2) }).more).toBe(
      true,
    );
    expect(
      needsMore({ seasons: EARLY_SEASONS - 200, title: d(-0.05, 0.01), wins: d(-1, 0.2) }).more,
    ).toBe(true);
  });

  it("pairs P(best) by chunk number across groups (separate chunk results, same seasons)", () => {
    // Group A's and group B's chunks are posted separately but cover the same chunk numbers.
    const chunks = Array.from({ length: 30 }, (_, i) => [
      chunk(i, { good: { mean: 0.03, sd: 0.1 } }),
      chunk(i, { meh: { mean: 0.0, sd: 0.1 } }),
    ]).flat();
    const [good, meh] = combine(chunks, ["good", "meh"]);
    expect(good!.seasons).toBe(6000);
    expect(good!.pBest!).toBeGreaterThan(0.95);
    expect(meh!.pBest!).toBeLessThan(0.05);
  });

  it("only moves within reach of the leader compete for best; the rest get 0", () => {
    const chunks = Array.from({ length: 30 }, (_, i) =>
      chunk(i, {
        a: { mean: 0.03, sd: 0.1 },
        b: { mean: 0.029, sd: 0.1 },
        far: { mean: -0.005, sd: 0.3 }, // behind, but not dropped
      }),
    );
    const effects = combine(chunks, ["a", "b", "far"]);
    expect(contendersOf(effects).map((e) => e.key)).toEqual(["a", "b"]);
    expect(effects[2]!.pBest).toBe(0);
    expect(effects[0]!.pBest! + effects[1]!.pBest!).toBeCloseTo(1, 9);
  });

  it("averages the Outlook over chunks by seasons", () => {
    const out = combineOutlook([chunk(0, {}, 100), chunk(1, {}, 300)]);
    expect(out[0]!.champ).toBeCloseTo(0.1, 9);
  });
});
