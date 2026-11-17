// Teammate returns, test 4 (MODEL_CARD pre-registration 2026-11-17): when a regular comes back,
// a same-position teammate whose minutes rose ≥ 6 while he was out keeps a share of his surge
// that depends on his position. The model moves today's projection toward the one from only
// games with the returning player by a fitted share per position group (λ_G, λ_F, λ_C), each
// season fitted only on earlier ones (walk-forward, 2018-19 to 2023-24; 2017-18 trains only).
// Events as tests 2 and 3 (scripts/teammate-return-events.ts). Read-only: cached public ESPN
// game logs and positions, and the league's scoring settings.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-teammate-return-4.ts
//   DRY=1 ...   event counts only (no outcomes)

import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { espnConfig } from "../lib/env";
import { analyze, mean, type Row } from "./teammate-return-events";

const SEASONS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const TESTED = SEASONS.slice(1);
const MIN_SHIFT = 6;
const GROUPS = ["G", "F", "C"] as const;
const BOOT = 4000;
/** Two comparisons (all groups; centers): Bonferroni for 95% overall. */
const ALPHA = 0.05 / 2;
const SEED = 20261119;

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

type Scored = Row & { pred: number };

/** Mean (model error − today's error), with a (1 − ALPHA) interval clustered by player. */
function judge(rows: Scored[]) {
  const diff = (r: Scored) => Math.abs(r.pred - r.actual) - Math.abs(r.base - r.actual);
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.season}:${r.player}`;
    by.set(k, [...(by.get(k) ?? []), diff(r)]);
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
    today: mean(rows.map((r) => Math.abs(r.base - r.actual))),
    model: mean(rows.map((r) => Math.abs(r.pred - r.actual))),
    diff: mean(rows.map(diff)),
    lo: ms[Math.floor((ALPHA / 2) * BOOT)]!,
    hi: ms[Math.floor((1 - ALPHA / 2) * BOOT)]!,
    biasToday: mean(rows.map((r) => r.base - r.actual)),
    biasModel: mean(rows.map((r) => r.pred - r.actual)),
  };
}

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const set = SEASONS.flatMap((s) => analyze(s, scoring)).filter(
    (r) => r.sameGroup && r.minShift >= MIN_SHIFT,
  );
  if (process.env.DRY) {
    for (const s of SEASONS)
      console.log(
        `${s - 1}-${String(s).slice(2)}${s === SEASONS[0] ? " (trains only)" : ""}: ` +
          GROUPS.map(
            (g) => `${g} ${set.filter((r) => r.season === s && r.group === g).length}`,
          ).join(", "),
      );
    return;
  }
  const scored: Scored[] = [];
  console.log("| Tested season | λ guards | λ forwards | λ centers (fitted on earlier seasons) |");
  console.log("|---|---|---|---|");
  for (const s of TESTED) {
    const train = set.filter((r) => r.season < s);
    const lam = Object.fromEntries(
      GROUPS.map((g) => [g, fitLambda(train.filter((r) => r.group === g))]),
    ) as Record<(typeof GROUPS)[number], number>;
    console.log(
      `| ${s - 1}-${String(s).slice(2)} | ${lam.G.toFixed(2)} | ${lam.F.toFixed(2)} | ${lam.C.toFixed(2)} |`,
    );
    for (const r of set.filter((x) => x.season === s))
      scored.push({ ...r, pred: r.base - lam[r.group as "G" | "F" | "C"] * (r.base - r.A) });
  }
  console.log(
    "\n| Set | n | MAE today | MAE model | Model − today | 97.5% CI (by player) | Signed error today → model |",
  );
  console.log("|---|---|---|---|---|---|---|");
  const passed: string[] = [];
  for (const [label, rows] of [
    ["1. Same-position backups, minutes up ≥ 6", scored],
    ["2. Centers among them", scored.filter((r) => r.group === "C")],
  ] as const) {
    const j = judge(rows);
    if (j.hi < 0) passed.push(label);
    console.log(
      `| ${label} | ${j.n} (${j.players} players) | ${j.today.toFixed(2)} | ${j.model.toFixed(2)} | ${j.diff >= 0 ? "+" : ""}${j.diff.toFixed(3)} | [${j.lo.toFixed(3)}, ${j.hi.toFixed(3)}] | ${j.biasToday.toFixed(2)} → ${j.biasModel.toFixed(2)} |`,
    );
  }
  console.log(`\nPassed: ${passed.length ? passed.join("; ") : "none"}`);
  // The shares production would use: fitted on all seven seasons.
  console.log(
    `λ on all seven seasons: ` +
      GROUPS.map((g) => `${g} ${fitLambda(set.filter((r) => r.group === g)).toFixed(2)}`).join(
        ", ",
      ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
