// Exploration, not a test (MODEL_CARD, teammate returns): what happens to a fill-in when the
// regular he replaced comes back, over every season tests 2 and 3 used (2017-18 to 2023-24),
// and how much of it today's projection already expects. Same events as the tests
// (scripts/teammate-return-events.ts). Read-only: cached public ESPN game logs and positions.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/explore-teammate-returns.ts

import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { espnConfig } from "../lib/env";
import { analyze, mean, type Row } from "./teammate-return-events";

// As recorded in MODEL_CARD: events with undefined values included (erratum, Nov 17).
const RECORDED = { includeUndefined: true };

const SEASONS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "–");
const sgn = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;

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

/** Mean of `f` with a 95% bootstrap interval clustered by player. */
function ci(rows: Row[], f: (r: Row) => number) {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.season}:${r.player}`;
    by.set(k, [...(by.get(k) ?? []), f(r)]);
  }
  const cl = [...by.values()];
  const draw = rng(20261117);
  const ms: number[] = [];
  for (let b = 0; b < 2000; b++) {
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
  return `${sgn(mean(rows.map(f)))} [${sgn(ms[50]!)}, ${sgn(ms[1949]!)}]`;
}

function table(title: string, sets: [string, Row[]][]) {
  console.log(`\n### ${title}\n`);
  console.log(
    "| Group | n | FP/G before | during | after (actual) | today's projection | min before → during → after | today − actual (95% CI) |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const [label, rows] of sets) {
    if (rows.length < 5) continue;
    const ok = rows.filter((r) => Number.isFinite(r.fpBefore));
    console.log(
      `| ${label} | ${rows.length} | ${f1(mean(ok.map((r) => r.fpBefore)))} | ${f1(mean(rows.map((r) => r.fpDuring)))} | ${f1(mean(rows.map((r) => r.actual)))} | ${f1(mean(rows.map((r) => r.base)))} | ${f1(mean(ok.map((r) => r.minBefore)))} → ${f1(mean(rows.map((r) => r.minDuring)))} → ${f1(mean(rows.map((r) => r.minAfter)))} | ${ci(rows, (r) => r.base - r.actual)} |`,
    );
  }
}

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const all = SEASONS.flatMap((s) => analyze(s, scoring, RECORDED));
  const backups = all.filter((r) => r.sameGroup && r.minShift >= 6);
  // The returning player's quality: thirds of T's FP/G over his last 10 games, among these.
  const tq = backups.map((r) => r.tFp).sort((a, b) => a - b);
  const [lo, hi] = [tq[Math.floor(tq.length / 3)]!, tq[Math.floor((2 * tq.length) / 3)]!];
  console.log(`Seasons 2017-18 to 2023-24: ${all.length} player-events.`);
  console.log(
    `Returning player's FP/G thirds among big-minute backups: < ${f1(lo)}, ${f1(lo)}–${f1(hi)}, ≥ ${f1(hi)}.`,
  );

  table("Who loses production when the regular returns", [
    ["Every affected teammate", all],
    ["Other positions, minutes up ≥ 6", all.filter((r) => !r.sameGroup && r.minShift >= 6)],
    ["Same position, minutes up < 6", all.filter((r) => r.sameGroup && r.minShift < 6)],
    ["Same position, minutes up ≥ 6", backups],
  ]);
  table("Same-position backups, minutes up ≥ 6, by position", [
    ["Guards", backups.filter((r) => r.group === "G")],
    ["Forwards", backups.filter((r) => r.group === "F")],
    ["Centers", backups.filter((r) => r.group === "C")],
  ]);
  table("By how good the returning player is", [
    [`Returning player < ${f1(lo)} FP/G`, backups.filter((r) => r.tFp < lo)],
    [`${f1(lo)}–${f1(hi)}`, backups.filter((r) => r.tFp >= lo && r.tFp < hi)],
    [`Star: ≥ ${f1(hi)}`, backups.filter((r) => r.tFp >= hi)],
    ["Star, centers", backups.filter((r) => r.tFp >= hi && r.group === "C")],
  ]);
  table("By the minutes jump", [
    ["Minutes up 6–10", backups.filter((r) => r.minShift < 10)],
    ["10–15", backups.filter((r) => r.minShift >= 10 && r.minShift < 15)],
    ["≥ 15", backups.filter((r) => r.minShift >= 15)],
  ]);
  // How much of the surge today's projection carries, and how much survives the return.
  const surge = backups.filter((r) => Number.isFinite(r.fpBefore) && r.fpDuring - r.fpBefore >= 3);
  const share = (f: (r: Row) => number) =>
    mean(surge.map(f)) / mean(surge.map((r) => r.fpDuring - r.fpBefore));
  console.log(
    `\nBig-minute backups whose FP/G rose ≥ 3 during the absence (n ${surge.length}): ` +
      `the surge averaged +${f1(mean(surge.map((r) => r.fpDuring - r.fpBefore)))} FP/G; ` +
      `today's projection on the return day carries ${(100 * share((r) => r.base - r.fpBefore)).toFixed(0)}% of it; ` +
      `after the return ${(100 * share((r) => r.actual - r.fpBefore)).toFixed(0)}% of it remains.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
