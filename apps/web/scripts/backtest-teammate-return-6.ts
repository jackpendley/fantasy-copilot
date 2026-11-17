// Teammate returns, test 6 (MODEL_CARD pre-registration 2026-11-17, before any data): when a big
// returns, does a backup big whose minutes rose ≥ 6 keep fewer minutes than today's projection
// expects? Bigs by their own stats (rebounds + blocks per 36 ≥ 11.5, before the game); the model
// moves only his minutes, by a share λ = 0.33 frozen from 2017-26, and keeps his rate. Judged
// once on 1994-95 to 2016-17 (box scores: scripts/fetch-history-boxscores.ts), clean events.
// Read-only. League scoring from the anonymized fixture (identical to docs/LEAGUE.md).
//
//   HISTORY_CACHE=data/local/backtest-boxscores DRY=1 node --conditions=react-server --import tsx scripts/backtest-teammate-return-6.ts
//   HISTORY_CACHE=data/local/backtest-boxscores node --conditions=react-server --import tsx scripts/backtest-teammate-return-6.ts

import { readFileSync } from "node:fs";
import { parseSettings } from "@fantasy-copilot/espn";
import { analyze, mean, type Row } from "./teammate-return-events";

/** Tested seasons by end year (1994-95 to 2016-17); 1993-94 is only the first one's prior. */
const SEASONS = Array.from({ length: 23 }, (_, i) => 1995 + i);
const BIG = 11.5;
const MIN_SHIFT = 6;
const LAMBDA = 0.33;
/** The gate: fewer events than this and nothing is evaluated (about 70% power). */
const MIN_EVENTS = 110;
const BOOT = 4000;
const ALPHA = 0.05;
const SEED = 20261121;
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
  const set = SEASONS.flatMap((s) => analyze(s, scoring)).filter(
    (r) => r.pRb36 >= BIG && r.tRb36 >= BIG && r.minShift >= MIN_SHIFT,
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
    console.log(
      usable.length >= MIN_EVENTS
        ? `Gate met (≥ ${MIN_EVENTS}).`
        : `Gate NOT met (< ${MIN_EVENTS}): stop.`,
    );
    return;
  }
  if (usable.length < MIN_EVENTS)
    throw new Error(`${usable.length} events: below the pre-registered gate of ${MIN_EVENTS}`);

  const scored: Scored[] = usable.map((r) => {
    const m = r.baseMin!;
    const predMin = m - LAMBDA * (m - r.aMin!);
    return { ...r, predMin, pred: (r.base * predMin) / m };
  });
  const err = (r: Scored) => Math.abs(r.pred - r.actual) - Math.abs(r.base - r.actual);
  const j = judge(scored, err);
  const sign = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
  console.log("| Set | n | MAE today | MAE model | Model − today | 95% CI (by player-season) |");
  console.log("|---|---|---|---|---|---|");
  console.log(
    `| Backup bigs, minutes up ≥ ${MIN_SHIFT} | ${j.n} (${j.clusters}) | ${mean(scored.map((r) => Math.abs(r.base - r.actual))).toFixed(2)} | ${mean(scored.map((r) => Math.abs(r.pred - r.actual))).toFixed(2)} | ${sign(j.mean)} | [${sign(j.lo)}, ${sign(j.hi)}] |`,
  );
  console.log(`\n${j.hi < 0 ? "PASSED" : "Not passed"}`);

  // Described, not tested.
  console.log("\nDescribed (not tested):");
  for (const [label, a, b] of ERAS) {
    const rows = scored.filter((r) => r.season >= a && r.season <= b);
    if (rows.length)
      console.log(
        `- ${label}: n ${rows.length}, model − today ${sign(mean(rows.map(err)))} FP/G; signed error today ${mean(rows.map((r) => r.base - r.actual)).toFixed(2)}, model ${mean(rows.map((r) => r.pred - r.actual)).toFixed(2)}`,
      );
  }
  console.log(
    `- Signed error, all: today ${mean(scored.map((r) => r.base - r.actual)).toFixed(2)} FP/G, model ${mean(scored.map((r) => r.pred - r.actual)).toFixed(2)}`,
  );
  console.log(
    `- Minutes MAE: today ${mean(scored.map((r) => Math.abs(r.baseMin! - r.minAfter))).toFixed(2)}, model ${mean(scored.map((r) => Math.abs(r.predMin - r.minAfter))).toFixed(2)}; signed today ${mean(scored.map((r) => r.baseMin! - r.minAfter)).toFixed(2)} min/G`,
  );
  const labelled = scored.filter((r) => r.group === "C" && r.tGroup === "C");
  if (labelled.length)
    console.log(
      `- Pairs ESPN labels C today (look-ahead): n ${labelled.length}, model − today ${sign(mean(labelled.map(err)))} FP/G`,
    );
}

main();
