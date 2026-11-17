// Teammate returns, test 5 (MODEL_CARD pre-registration 2026-11-17): group the positions by
// ESPN eligibility, centers being every C-eligible player, instead of by ESPN's primary position
// (test 4's model, as shipped). Each model's shares are fitted on 2017-18 to 2023-24 and judged
// on 2024-25 and 2025-26 (test 1 used them for its own question; nothing by position). Events as
// tests 2-4 (scripts/teammate-return-events.ts). Read-only: cached public ESPN game logs,
// positions and eligibility, and the league's scoring settings.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-teammate-return-5.ts
//   DRY=1 ...   event counts only (no outcomes)

import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { espnConfig } from "../lib/env";
import { analyze, mean, type Row } from "./teammate-return-events";

// As recorded in MODEL_CARD: events with undefined values included (erratum, Nov 17).
const RECORDED = { includeUndefined: true };

const TRAIN = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const TEST = [2025, 2026];
const MIN_SHIFT = 6;
const C_SLOT = 4;
const BOOT = 4000;
/** One comparison. */
const ALPHA = 0.05;
const SEED = 20261120;

type Group = "G" | "F" | "C";
/** Test 4's grouping: ESPN's primary position. */
const primary = (g: string | null, _elig: number[]) => g as Group | null;
/** The candidate: every C-eligible player is a center, the rest by primary position. */
const eligible = (g: string | null, elig: number[]) =>
  elig.includes(C_SLOT) ? "C" : (g as Group | null);

/** The group a model adjusts this event under, or null if it leaves it at today's projection. */
function pairOf(r: Row, by: typeof primary): Group | null {
  const p = by(r.group, r.pElig);
  return p != null && p === by(r.tGroup, r.tElig) ? p : null;
}

/** Least-squares share of (today − with-him) to take away, within [0, 1]. */
function fitLambda(rows: Row[]): number {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const gap = r.base - r.A;
    num += gap * (r.base - r.actual);
    den += gap * gap;
  }
  return den > 0 ? Math.min(1, Math.max(0, num / den)) : 0;
}

function fit(rows: Row[], by: typeof primary) {
  return Object.fromEntries(
    (["G", "F", "C"] as const).map((g) => [g, fitLambda(rows.filter((r) => pairOf(r, by) === g))]),
  ) as Record<Group, number>;
}

const predict = (r: Row, by: typeof primary, lam: Record<Group, number>) => {
  const g = pairOf(r, by);
  return g ? r.base - lam[g] * (r.base - r.A) : r.base;
};

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

type Scored = Row & { m4: number; m5: number };

/** Mean of `f` with a (1 − ALPHA) bootstrap interval clustered by player. */
function judge(rows: Scored[], f: (r: Scored) => number) {
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
    players: cl.length,
    diff: mean(rows.map(f)),
    lo: ms[Math.floor((ALPHA / 2) * BOOT)]!,
    hi: ms[Math.floor((1 - ALPHA / 2) * BOOT)]!,
  };
}

const sgn = (x: number, d = 3) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}`;
const season = (s: number) => `${s - 1}-${String(s).slice(2)}`;

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const rowsOf = (seasons: number[]) =>
    seasons
      .flatMap((s) => analyze(s, scoring, RECORDED))
      .filter((r) => r.minShift >= MIN_SHIFT && (pairOf(r, primary) || pairOf(r, eligible)));
  const train = rowsOf(TRAIN);
  const test = rowsOf(TEST);
  if (process.env.DRY) {
    for (const [label, rows] of [
      ["Train 2017-18 to 2023-24", train],
      ...TEST.map((s) => [season(s), test.filter((r) => r.season === s)] as const),
    ] as const) {
      const n = (f: (r: Row) => boolean) => rows.filter(f).length;
      console.log(
        `${label}: ${rows.length} events; test 4 pairs G/F/C ${["G", "F", "C"].map((g) => n((r) => pairOf(r, primary) === g)).join("/")}; ` +
          `candidate pairs G/F/C ${["G", "F", "C"].map((g) => n((r) => pairOf(r, eligible) === g)).join("/")}; ` +
          `paired differently ${n((r) => pairOf(r, primary) !== pairOf(r, eligible))}; ` +
          `no eligibility ${n((r) => !r.pElig.length || !r.tElig.length)}`,
      );
    }
    return;
  }
  const lam4 = fit(train, primary);
  const lam5 = fit(train, eligible);
  const fmt = (l: Record<Group, number>) =>
    `G ${l.G.toFixed(2)}, F ${l.F.toFixed(2)}, C ${l.C.toFixed(2)}`;
  console.log(
    `Shares fitted on 2017-18 to 2023-24: test 4's grouping ${fmt(lam4)}; candidate ${fmt(lam5)}.`,
  );
  const scored: Scored[] = test.map((r) => ({
    ...r,
    m4: predict(r, primary, lam4),
    m5: predict(r, eligible, lam5),
  }));
  const err = (x: number, r: Row) => Math.abs(x - r.actual);
  console.log(
    "\n| Set | n | MAE today | MAE test 4's model | MAE candidate | Candidate − test 4's model | 95% CI (by player) | Signed error today → test 4 → candidate |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const [label, rows] of [
    ["Every event either model adjusts (the test)", scored],
    [
      "— paired differently by the two",
      scored.filter((r) => pairOf(r, primary) !== pairOf(r, eligible)),
    ],
    ["— candidate's centers", scored.filter((r) => pairOf(r, eligible) === "C")],
  ] as const) {
    if (!rows.length) continue;
    const j = judge(rows, (r) => err(r.m5, r) - err(r.m4, r));
    console.log(
      `| ${label} | ${j.n} (${j.players} players) | ${mean(rows.map((r) => err(r.base, r))).toFixed(2)} | ${mean(rows.map((r) => err(r.m4, r))).toFixed(2)} | ${mean(rows.map((r) => err(r.m5, r))).toFixed(2)} | ${sgn(j.diff)} | [${sgn(j.lo)}, ${sgn(j.hi)}] | ${sgn(mean(rows.map((r) => r.base - r.actual)), 2)} → ${sgn(mean(rows.map((r) => r.m4 - r.actual)), 2)} → ${sgn(mean(rows.map((r) => r.m5 - r.actual)), 2)} |`,
    );
  }
  const t = judge(scored, (r) => err(r.m5, r) - err(r.m4, r));
  console.log(
    `\n${t.hi < 0 ? "PASSED" : "Not passed"}: the candidate's interval [${sgn(t.lo)}, ${sgn(t.hi)}].`,
  );
  // Described: each against today's projection on the same events.
  for (const [label, k] of [
    ["Test 4's model", "m4"],
    ["Candidate", "m5"],
  ] as const) {
    const j = judge(scored, (r) => err(r[k], r) - err(r.base, r));
    console.log(`${label} − today: ${sgn(j.diff)} [${sgn(j.lo)}, ${sgn(j.hi)}]`);
  }
  console.log(
    `Shares on all nine seasons: test 4's grouping ${fmt(fit([...train, ...test], primary))}; candidate ${fmt(fit([...train, ...test], eligible))}.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
