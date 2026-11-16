import { describe, expect, it } from "vitest";
import type { ChunkResult } from "@fantasy-copilot/fantasy-core";
import type { DeepEffect } from "@/lib/nba/deep-check";
import {
  combine,
  combineOutlook,
  contendersOf,
  markPicks,
  needsMore,
  headToHeadFromSums,
  headToHeadOf,
  pairedDiff,
  pairsNeeded,
  pickDrop,
  promotions,
  racingTargets,
  DECISION_TIER,
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
    // Top tier: ±0.2 title points.
    expect(
      needsMore({ seasons: top.minSeasons, title: d(0.01, 0.0011), wins: d(0, 0.01) }).more,
    ).toBe(true); // ±0.22
    expect(
      needsMore({ seasons: top.minSeasons, title: d(0.01, 0.0009), wins: d(0, 0.01) }).more,
    ).toBe(false); // ±0.18
    // Decision tier: ±0.1, up to 160,000 seasons.
    const decision = DECISION_TIER;
    expect(
      needsMore({ seasons: 40_000, title: d(0.01, 0.0009), wins: d(0, 0.01) }, decision).more,
    ).toBe(true); // ±0.18
    expect(
      needsMore({ seasons: 40_000, title: d(0.01, 0.00045), wins: d(0, 0.01) }, decision).more,
    ).toBe(false); // ±0.09
    expect(
      needsMore({ seasons: 160_000, title: d(0, 0.001), wins: d(0, 0.01) }, decision).more,
    ).toBe(false);
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

  it("compares two moves head to head over the chunks they share", () => {
    const means = new Map([
      ["a", new Map([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => [c, { title: c, wins: 0 }]))],
      // b trails a by 1 or 3 in alternate chunks, and is missing chunk 9.
      [
        "b",
        new Map(
          [0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => [c, { title: c - (c % 2 ? 3 : 1), wins: 0 }]),
        ),
      ],
    ]);
    const p = pairedDiff("a", "b", means)!;
    // Diffs 1,3,1,3,1,3,1,3,1 over 9 shared chunks: mean 17/9.
    expect(p.d).toBeCloseTo(17 / 9, 12);
    const v = [1, 3, 1, 3, 1, 3, 1, 3, 1].reduce((s, x) => s + (x - 17 / 9) ** 2, 0) / 8;
    expect(p.se).toBeCloseTo(Math.sqrt(v / 9), 12);
    // Too few chunks in common: no head-to-head number.
    expect(
      pairedDiff("a", "b", new Map([...means].map(([k, m]) => [k, new Map([...m].slice(0, 5))]))),
    ).toBeNull();
  });
  it("averages the Outlook over chunks by seasons", () => {
    const out = combineOutlook([chunk(0, {}, 100), chunk(1, {}, 300)]);
    expect(out[0]!.champ).toBeCloseTo(0.1, 9);
  });
});

const fx = (
  key: string,
  title: number,
  se: number,
  wins = 0,
  extra: Partial<DeepEffect> = {},
): DeepEffect => ({
  key,
  seasons: 6000,
  title: { d: title, se },
  playoffs: { d: 0, se: 0 },
  seed1: { d: 0, se: 0 },
  bye: { d: 0, se: 0 },
  wins: { d: wins, se: 0.01 },
  pBetter: 0.5,
  pBest: null,
  active: false,
  dropped: false,
  ...extra,
});

/** Ten shared chunks whose title means sit at `title` (± a wobble every move shares). */
const meansOf = (moves: Record<string, number>) =>
  new Map(
    Object.entries(moves).map(([k, t]) => [
      k,
      new Map(Array.from({ length: 10 }, (_, c) => [c, { title: t + (c % 3) * 0.01, wins: 0 }])),
    ]),
  );

describe("racing and each card's pick (ADR-063)", () => {
  it("opens on the more title odds, but breaks a tie within the noise by expected wins", () => {
    // The Paul Reed card on Nov 16: Reid's drop (40,000 seasons) and Dunn's (6,000) both +0.5.
    const reid = fx("1:reid:", 0.005, 0.001, 0.17);
    const dunn = fx("1:dunn:", 0.0052, 0.0025, 0.14);
    expect(pickDrop([dunn, reid])!.key).toBe("1:reid:");
    // A clear title leader wins even with fewer expected wins.
    const clear = fx("1:x:", 0.012, 0.001, 0.1);
    expect(pickDrop([reid, clear])!.key).toBe("1:x:");
    // Tied on wins too: the better win chance this week.
    const a = fx("1:a:", 0.005, 0.002, 0.15);
    const b = fx("1:b:", 0.005, 0.002, 0.15);
    const week = new Map([
      ["1:a:", 0.05],
      ["1:b:", 0.09],
    ]);
    expect(pickDrop([a, b], undefined, (o) => week.get(o.key)!)!.key).toBe("1:b:");
  });

  it("head to head, a small but steady edge decides", () => {
    // Margins overlap on their own, but b trails a in every shared chunk by 0.001.
    const a = fx("1:a:", 0.006, 0.002, 0.1);
    const b = fx("1:b:", 0.005, 0.002, 0.2);
    const means = meansOf({ "1:a:": 0.006, "1:b:": 0.005 });
    means.get("1:b:")!.set(0, { title: 0.004, wins: 0 }); // not quite steady
    expect(pickDrop([a, b])!.key).toBe("1:b:"); // without head to head: a tie, b has more wins
    expect(pickDrop([a, b], headToHeadOf(means))!.key).toBe("1:a:");
  });

  it("promotes a card's rivals to the top tier and the best move's to the decision tier", () => {
    const opening = fx("1:reid:", 0.005, 0.001, 0.17);
    const rival = fx("1:dunn:", 0.0052, 0.0025, 0.14);
    const far = fx("1:allen:", -0.01, 0.001, -0.1);
    const gone = fx("1:tatum:", -0.03, 0.002, -0.5, { dropped: true });
    const other = fx("2:green:", -0.004, 0.001); // another add whose card isn't top tier
    const tiers = new Map([["1:reid:", TOP_TIER]]);
    const promo = promotions(
      [opening, rival, far, gone, other],
      (k) => tiers.get(k) ?? REST_TIER,
      headToHeadOf(meansOf({ "1:reid:": 0.005, "1:allen:": -0.01 })),
    );
    // Reid's and Dunn's drops race for Jack's best move (both gain title odds).
    expect(promo.get("1:reid:")).toBe(DECISION_TIER);
    expect(promo.get("1:dunn:")).toBe(DECISION_TIER);
    expect(promo.has("1:allen:")).toBe(false); // clearly behind, head to head
    expect(promo.has("1:tatum:")).toBe(false);
    expect(promo.has("2:green:")).toBe(false);
  });

  it("only raises a tier, and never races trades", () => {
    const a = fx("1:a:", -0.002, 0.001);
    const b = fx("1:b:", -0.0025, 0.002);
    const t = fx("trade:9:1:2", 0.02, 0.001);
    const tiers = new Map([
      ["1:a:", TOP_TIER],
      ["1:b:", DECISION_TIER],
    ]);
    const promo = promotions([a, b, t], (k) => tiers.get(k) ?? REST_TIER);
    expect([...promo]).toEqual([]);
  });

  it("marks one pick per add", () => {
    const effects = markPicks([
      fx("1:reid:", 0.005, 0.001, 0.17),
      fx("1:dunn:", 0.0052, 0.0025, 0.14),
      fx("2:a:", -0.004, 0.001),
      fx("2:b:", -0.002, 0.001),
      fx("trade:9:1:2", 0.02, 0.001),
    ]);
    expect(effects.filter((e) => e.pick).map((e) => e.key)).toEqual(["1:reid:", "2:b:"]);
  });
  it("per-pair sums from the database give the same head to head as the chunks", () => {
    const means = meansOf({ "1:a:": 0.006, "1:b:": 0.005 });
    means.get("1:b:")!.set(0, { title: 0.004, wins: 0 });
    const diffs = [...means.get("1:a:")!].map(
      ([c, x]) => x.title - means.get("1:b:")!.get(c)!.title,
    );
    const h2h = headToHeadFromSums([
      {
        a: "1:a:",
        b: "1:b:",
        n: diffs.length,
        s: diffs.reduce((t, x) => t + x, 0),
        q: diffs.reduce((t, x) => t + x * x, 0),
      },
    ]);
    const want = pairedDiff("1:a:", "1:b:", means)!;
    expect(h2h("1:a:", "1:b:")!.d).toBeCloseTo(want.d, 12);
    expect(h2h("1:a:", "1:b:")!.se).toBeCloseTo(want.se, 12);
    // Asked the other way round, it flips.
    expect(h2h("1:b:", "1:a:")!.d).toBeCloseTo(-want.d, 12);
    // Too few shared chunks: unknown.
    expect(headToHeadFromSums([{ a: "x", b: "y", n: 5, s: 1, q: 1 }])("x", "y")).toBeNull();
  });

  it("asks only for each add's leader against its drops, and the best move against the gainers", () => {
    const pairs = pairsNeeded([
      fx("1:reid:", 0.005, 0.001),
      fx("1:dunn:", 0.003, 0.001),
      fx("1:gone:", -0.03, 0.001, -0.5, { dropped: true }),
      fx("2:a:", 0.004, 0.001),
      fx("2:b:", -0.002, 0.001),
      fx("trade:9:1:2", 0.02, 0.001),
    ]);
    expect(pairs).toEqual([
      ["1:reid:", "1:dunn:"],
      ["2:a:", "2:b:"],
      ["1:reid:", "2:a:"],
    ]);
  });
  it("racing elimination: a promoted move clearly behind its race's leader stops racing", () => {
    const best = fx("1:reid:", 0.006, 0.0005, 0.17);
    const close = fx("1:dunn:", 0.0058, 0.0005, 0.11);
    const behind = fx("2:x:", 0.002, 0.0005, 0.05); // out of the race for the best move
    const card = fx("3:a:", -0.002, 0.0005);
    const cardBehind = fx("3:b:", -0.006, 0.0005); // behind his card's best
    const racing = new Map([
      ["1:reid:", DECISION_TIER],
      ["1:dunn:", DECISION_TIER],
      ["2:x:", DECISION_TIER],
      ["3:b:", TOP_TIER],
    ]);
    const lowered = racingTargets(
      [best, close, behind, card, cardBehind],
      (k) => racing.get(k) ?? null,
    );
    // Still in reach: no change. Out of the best-move race but his card's best: a card's ±0.2.
    expect(lowered.has("1:reid:")).toBe(false);
    expect(lowered.has("1:dunn:")).toBe(false);
    expect(lowered.get("2:x:")).toBe(TOP_TIER);
    // Behind his card's best drop: the rest tier (stops).
    expect(lowered.get("3:b:")).toBe(REST_TIER);
    // Never promoted: untouched.
    expect(lowered.has("3:a:")).toBe(false);
  });
});
