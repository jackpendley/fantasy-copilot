// Exploration, not a test (MODEL_CARD, teammate returns, test 5's lead): does a returning
// center hit a PF/C fill-in like a backup center or like a forward, and does grouping by ESPN's
// eligibility or by a big's stats (rebounds plus blocks per 36) separate the fill-ins who lose
// their surge better than ESPN's primary position? Every season tests 2-4 used (2017-18 to
// 2023-24), the same events (scripts/teammate-return-events.ts), fill-ins whose minutes rose ≥ 6.
// Read-only: cached public ESPN game logs, positions and eligibility (scripts/fetch-history.ts).
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/explore-teammate-positions.ts

import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { espnConfig } from "../lib/env";
import { analyze, mean, type Row } from "./teammate-return-events";

// As recorded in MODEL_CARD: events with undefined values included (erratum, Nov 17).
const RECORDED = { includeUndefined: true };

const SEASONS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
const PF = 3;
const C = 4;
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

/** The least-squares share of the gap (today − with-him) the return takes back, clipped to [0, 1]. */
function lambda(rows: Row[]) {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    num += (r.base - r.actual) * (r.base - r.A);
    den += (r.base - r.A) ** 2;
  }
  return den ? Math.min(1, Math.max(0, num / den)) : NaN;
}

function table(title: string, sets: [string, Row[]][]) {
  console.log(`\n### ${title}\n`);
  console.log(
    "| Group | n | FP/G before | during | after (actual) | today's projection | min before → during → after | today − actual (95% CI) | fitted share λ |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const [label, rows] of sets) {
    if (!rows.length) {
      console.log(`| ${label} | 0 | | | | | | | |`);
      continue;
    }
    const ok = rows.filter((r) => Number.isFinite(r.fpBefore));
    console.log(
      `| ${label} | ${rows.length} | ${f1(mean(ok.map((r) => r.fpBefore)))} | ${f1(mean(rows.map((r) => r.fpDuring)))} | ${f1(mean(rows.map((r) => r.actual)))} | ${f1(mean(rows.map((r) => r.base)))} | ${f1(mean(ok.map((r) => r.minBefore)))} → ${f1(mean(rows.map((r) => r.minDuring)))} → ${f1(mean(rows.map((r) => r.minAfter)))} | ${ci(rows, (r) => r.base - r.actual)} | ${f1(lambda(rows) * 100)}% |`,
    );
  }
}

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const up = SEASONS.flatMap((s) => analyze(s, scoring, RECORDED)).filter((r) => r.minShift >= 6);
  const known = up.filter((r) => r.pElig.length && r.tElig.length);
  console.log(
    `Seasons 2017-18 to 2023-24: ${up.length} fill-in events (minutes up ≥ 6), ${known.length} with both players' eligibility.`,
  );
  // ESPN's primary position (as test 4 groups) and eligibility.
  const primaryC = (g: string | null) => g === "C";
  const isPFC = (g: string | null, elig: number[]) => g === "F" && elig.includes(C);
  const pureF = (g: string | null, elig: number[]) => g === "F" && !elig.includes(C);
  const cOnly = (r: Row) => primaryC(r.group) && !r.pElig.includes(PF);

  const cBack = known.filter((r) => primaryC(r.tGroup));
  table("A center (ESPN primary C) returns: who loses the surge?", [
    ["Fill-in primary C", cBack.filter((r) => primaryC(r.group))],
    ["— C only", cBack.filter((r) => cOnly(r))],
    ["— C, also PF-eligible", cBack.filter((r) => primaryC(r.group) && r.pElig.includes(PF))],
    ["Fill-in primary PF, C-eligible (PF/C)", cBack.filter((r) => isPFC(r.group, r.pElig))],
    ["Fill-in forward, not C-eligible", cBack.filter((r) => pureF(r.group, r.pElig))],
    ["Fill-in guard", cBack.filter((r) => r.group === "G")],
  ]);

  const pfcBack = known.filter((r) => isPFC(r.tGroup, r.tElig));
  table("A PF/C (primary PF, C-eligible: the Davis/Sabonis type) returns", [
    ["Fill-in primary C", pfcBack.filter((r) => primaryC(r.group))],
    ["Fill-in PF/C", pfcBack.filter((r) => isPFC(r.group, r.pElig))],
    ["Fill-in forward, not C-eligible", pfcBack.filter((r) => pureF(r.group, r.pElig))],
    ["Fill-in guard", pfcBack.filter((r) => r.group === "G")],
  ]);

  const fBack = known.filter((r) => pureF(r.tGroup, r.tElig));
  table("A forward who isn't C-eligible returns", [
    ["Fill-in primary C", fBack.filter((r) => primaryC(r.group))],
    ["Fill-in PF/C", fBack.filter((r) => isPFC(r.group, r.pElig))],
    ["Fill-in forward, not C-eligible", fBack.filter((r) => pureF(r.group, r.pElig))],
  ]);

  // By stats: a "big" is in the top third of rebounds plus blocks per 36 among these fill-ins
  // (for P) and among the returning players (for T).
  const third = (xs: number[]) =>
    xs.filter(Number.isFinite).sort((a, b) => a - b)[Math.floor((2 * xs.length) / 3)]!;
  const pCut = third(up.map((r) => r.pRb36));
  const tCut = third(up.map((r) => r.tRb36));
  const pBig = (r: Row) => r.pRb36 >= pCut;
  const tBig = (r: Row) => r.tRb36 >= tCut;
  console.log(
    `\nBigs by stats: fill-in ≥ ${f1(pCut)} rebounds + blocks per 36, returning player ≥ ${f1(tCut)}.`,
  );
  table("By a big's stats, whatever ESPN lists", [
    ["Big returns, big fill-in", up.filter((r) => tBig(r) && pBig(r))],
    ["Big returns, other fill-in", up.filter((r) => tBig(r) && !pBig(r))],
    ["Other returns, big fill-in", up.filter((r) => !tBig(r) && pBig(r))],
    ["Other returns, other fill-in", up.filter((r) => !tBig(r) && !pBig(r))],
  ]);
  table("Center pairs by ESPN vs by stats", [
    [
      "ESPN: C returns, C fill-in (test 4's centers)",
      up.filter((r) => r.sameGroup && r.group === "C"),
    ],
    [
      "Stats: big pair that ESPN doesn't call C-C",
      up.filter((r) => tBig(r) && pBig(r) && !(r.sameGroup && r.group === "C")),
    ],
    [
      "Eligibility: both C-eligible",
      known.filter((r) => r.pElig.includes(C) && r.tElig.includes(C)),
    ],
    [
      "— not both primary C",
      known.filter(
        (r) => r.pElig.includes(C) && r.tElig.includes(C) && !(r.group === "C" && r.tGroup === "C"),
      ),
    ],
  ]);
  table("Sharing an eligible position (any) vs not", [
    ["Share a position", known.filter((r) => r.pElig.some((s) => r.tElig.includes(s)))],
    ["Share none", known.filter((r) => !r.pElig.some((s) => r.tElig.includes(s)))],
  ]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
