// Teammate returns, test 7 (MODEL_CARD pre-registration 2026-11-19, before any outcome): when a
// big returns from 3+ missed team games, does moving each big teammate's minutes a share
// λ = 0.33 toward his minutes with the returning big (rate kept) predict his next 10 games
// better than today's projection? Bigs by their own stats (rebounds + blocks per 36 ≥ 11.5);
// no minutes-rise condition. Judged once on 1994-95 to 2016-17 (box scores:
// scripts/fetch-history-boxscores.ts), clean events. Fantasy points first; minutes only if it
// passes (fixed sequence, each 95%). Read-only. League scoring from the anonymized fixture.
//
//   HISTORY_CACHE=data/local/backtest-boxscores DRY=1 node --conditions=react-server --import tsx scripts/backtest-teammate-return-7.ts
//   HISTORY_CACHE=data/local/backtest-boxscores node --conditions=react-server --import tsx scripts/backtest-teammate-return-7.ts

import { readFileSync } from "node:fs";
import { parseSettings } from "@fantasy-copilot/espn";
import { analyze, mean, type Row } from "./teammate-return-events";

/** Tested seasons by end year (1994-95 to 2016-17); 1993-94 is only the first one's prior. */
const SEASONS = Array.from({ length: 23 }, (_, i) => 1995 + i);
const MIN_MISSED = 3;
const BIG = 11.5;
const LAMBDA = 0.33;
const BOOT = 4000;
const ALPHA = 0.05;
const SEED = 20261122;
const ERAS: [string, number, number][] = [
  ["1994-95 to 2002-03", 1995, 2003],
  ["2003-04 to 2009-10", 2004, 2010],
  ["2010-11 to 2016-17", 2011, 2017],
];

/** A seeded generator (reproducible bootstrap). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

type Scored = Row & { pred: number; predMin: number };

/** Mean of `f` with a 95% interval, 4,000 resamples clustered by player-season. */
function judge(rows: Scored[], f: (r: Scored) => number) {
  if (!rows.length) throw new Error("no events to judge");
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.season}:${r.player}`;
    by.set(k, [...(by.get(k) ?? []), f(r)]);
  }
  const cl = [...by.values()];
  const draw = rng(SEED);
  const ms: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < cl.length; i++) {
      const c = cl[Math.floor(draw() * cl.length)]!;
      for (const x of c) s += x;
      n += c.length;
    }
    ms.push(s / n);
  }
  ms.sort((a, b) => a - b);
  return {
    n: rows.length,
    clusters: cl.length,
    mean: mean(rows.map(f)),
    lo: ms[Math.floor((ALPHA / 2) * BOOT)]!,
    hi: ms[Math.floor((1 - ALPHA / 2) * BOOT)]!,
  };
}

function main() {
  if (!process.env.HISTORY_CACHE)
    throw new Error("HISTORY_CACHE must point at the box-score cache");
  const scoring = parseSettings(
    JSON.parse(
      readFileSync(
        new URL("../../../packages/espn/test/fixtures/league.json", import.meta.url),
        "utf8",
      ),
    ),
  ).scoring;
  const set = SEASONS.flatMap((s) => analyze(s, scoring, { minMissed: MIN_MISSED })).filter(
    (r) => r.pRb36 >= BIG && r.tRb36 >= BIG,
  );
  const usable = set.filter((r) => r.baseMin != null && r.aMin != null && r.baseMin > 0);

  if (process.env.DRY) {
    // Counts only: no outcome is computed or printed.
    for (const [label, a, b] of ERAS)
      console.log(
        `${label}: ${usable.filter((r) => r.season >= a && r.season <= b).length} events`,
      );
    console.log(
      `Total: ${usable.length} events (${new Set(usable.map((r) => `${r.season}:${r.player}`)).size} player-seasons); ` +
        `${set.length - usable.length} left out without a minutes estimate.`,
    );
    return;
  }

  const scored: Scored[] = usable.map((r) => {
    const m = r.baseMin!;
    const predMin = m - LAMBDA * (m - r.aMin!);
    return { ...r, predMin, pred: (r.base * predMin) / m };
  });
  const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
  const fpErr = (r: Scored) => Math.abs(r.pred - r.next10) - Math.abs(r.base - r.next10);
  const minErr = (r: Scored) => Math.abs(r.predMin - r.min10) - Math.abs(r.baseMin! - r.min10);
  const row = (label: string, j: ReturnType<typeof judge>, today: number, model: number) =>
    `| ${label} | ${j.n} (${j.clusters}) | ${today.toFixed(2)} | ${model.toFixed(2)} | ${sign(j.mean)} | [${sign(j.lo)}, ${sign(j.hi)}] |`;

  console.log(
    "| Comparison | n | MAE today | MAE model | Model − today | 95% CI (by player-season) |",
  );
  console.log("|---|---|---|---|---|---|");
  const fp = judge(scored, fpErr);
  console.log(
    row(
      "1. FP/G, next 10 games",
      fp,
      mean(scored.map((r) => Math.abs(r.base - r.next10))),
      mean(scored.map((r) => Math.abs(r.pred - r.next10))),
    ),
  );
  const fpPassed = fp.hi < 0;
  if (fpPassed) {
    const mn = judge(scored, minErr);
    console.log(
      row(
        "2. Minutes, next 10 games",
        mn,
        mean(scored.map((r) => Math.abs(r.baseMin! - r.min10))),
        mean(scored.map((r) => Math.abs(r.predMin - r.min10))),
      ),
    );
    console.log(`\n1: PASSED. 2: ${mn.hi < 0 ? "PASSED" : "not passed"}.`);
  } else console.log("\n1: not passed, so 2 is not tested.");

  // Described, not tested.
  const s2 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
  const line = (label: string, rows: Scored[]) =>
    rows.length
      ? `- ${label}: n ${rows.length}; FP model − today ${sign(mean(rows.map(fpErr)))}, minutes ${sign(mean(rows.map(minErr)))}; ` +
        `signed FP today ${s2(mean(rows.map((r) => r.base - r.next10)))}, model ${s2(mean(rows.map((r) => r.pred - r.next10)))}; ` +
        `signed minutes today ${s2(mean(rows.map((r) => r.baseMin! - r.min10)))}, model ${s2(mean(rows.map((r) => r.predMin - r.min10)))}`
      : `- ${label}: no events`;
  console.log("\nDescribed (not tested):");
  console.log(line("All", scored));
  for (const [label, a, b] of ERAS)
    console.log(
      line(
        label,
        scored.filter((r) => r.season >= a && r.season <= b),
      ),
    );
  console.log(
    line(
      "Absences of 5+ games",
      scored.filter((r) => r.missed >= 5),
    ),
  );
  console.log(
    line(
      "Minutes up ≥ 6 during the absence",
      scored.filter((r) => r.minShift >= 6),
    ),
  );
  console.log(
    line(
      "Pairs ESPN labels C today (look-ahead)",
      scored.filter((r) => r.group === "C" && r.tGroup === "C"),
    ),
  );
  const ros = (r: Scored) => Math.abs(r.pred - r.actual) - Math.abs(r.base - r.actual);
  console.log(
    `- Rest of season instead of next 10: FP model − today ${sign(mean(scored.map(ros)))}; signed today ${s2(mean(scored.map((r) => r.base - r.actual)))}, model ${s2(mean(scored.map((r) => r.pred - r.actual)))}`,
  );
}

main();
