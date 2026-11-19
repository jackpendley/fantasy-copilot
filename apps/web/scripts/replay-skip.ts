// The replay test for skipping unaffected moves (docs/COMPUTE.md §12, pre-registered before its
// run). A skipping job re-checks only the moves a trigger touches and the moves it makes new,
// and keeps the last full sweep's numbers for every other move until the next full sweep (the
// nightly run, or Jack's own move). This asks whether Jack then sees the same best moves, with
// numbers as close as production's own precision, as re-running everything would show.
//
// Two sets of jobs, every move played on the same chunks of seasons (common random numbers):
// - the 21 single changes of the tier guard (§11): its saved jobs and their simulated numbers;
// - two busy days, from a fresh read of the league with the same seeded picks: all 10 rival
//   add/drops at once, and those plus the first 3 injury news items (different players).
// For each change, the full view (every move's numbers after it) against the skipping view
// (after numbers for the re-checked moves, before numbers for the rest).
//
//   DRY=1 node --env-file=.env.local --conditions=react-server --import tsx scripts/replay-skip.ts
//   RESULT=data/local/replay-tiers/<guard result>.json node ... scripts/replay-skip.ts
//   SNAPSHOT=data/local/replay-tiers/<busy days>.json ... (re-run a saved set of busy days)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { TOP_TIER } from "../lib/nba/deep-check";
import {
  INJURY_NEWS,
  LEAGUE_MOVES,
  applyChange,
  ids,
  jobOf,
  pickChanges,
  readLeague,
  simulate,
  top5,
  valueOf,
  type Effect,
  type Job,
} from "./replay-tiers";

const dir = "data/local/replay-tiers";
/** The tier guard's saved jobs (§11): the league as read on Nov 19 and its 21 changes. */
const SINGLES = `${dir}/jobs-2026-11-19T1652.json`;
/** Injury news items in the second busy day. */
const BUSY_INJURIES = 3;
/** Re-checked besides the touched and new moves: none, then the fallback's 20 (§12). */
const CONTENDERS = [0, 20];
/** A shown number may be off by the top tier's precision target (±0.2 points). */
const TOLERANCE = TOP_TIER.target2se;
/** Singles per kind that must pass each measure (of 10); every busy day must pass both. */
const SINGLES_NEEDED = 9;

interface Case {
  job: Job;
  before: Job;
  beforeFx: Map<string, Effect>;
  full: Map<string, Effect>;
}

/** The re-checked moves: touched, new, and the before job's best `contenders`. */
function rechecked(c: Case, contenders: number): Set<string> {
  const had = new Set(c.before.moves.map((m) => m.key));
  const touched = new Set(c.job.touched);
  const best = [...c.beforeFx.values()]
    .sort((a, b) => b.d - a.d)
    .slice(0, contenders)
    .map((e) => e.key);
  return new Set([
    ...c.job.moves
      .filter((m) => !had.has(m.key) || ids(m.key).some((id) => touched.has(id)))
      .map((m) => m.key),
    ...best.filter((k) => c.job.moves.some((m) => m.key === k)),
  ]);
}

/**
 * 1. The recommended top 5 has the same moves and the same first move in both views.
 * 2. Every move in the full view's top 5 is shown within the tolerance of its full number.
 */
function score(c: Case, contenders: number) {
  const r = rechecked(c, contenders);
  const shown = (k: string) => (r.has(k) ? c.full.get(k) : (c.beforeFx.get(k) ?? c.full.get(k)));
  const skipping = c.job.moves.map((m) => shown(m.key)).filter((e): e is Effect => e != null);
  const fullTop = top5([...c.full.values()]);
  const skipTop = top5(skipping);
  const sameTop =
    fullTop[0] === skipTop[0] &&
    fullTop.length === skipTop.length &&
    fullTop.every((k) => skipTop.includes(k));
  const gap = Math.max(...fullTop.map((k) => Math.abs(shown(k)!.d - c.full.get(k)!.d)));
  return { rechecked: r.size, sameTop, gap, close: gap <= TOLERANCE, fullTop, skipTop };
}

async function busyDays(): Promise<Job[]> {
  if (process.env.SNAPSHOT) return JSON.parse(readFileSync(process.env.SNAPSHOT, "utf8"));
  const { setup, w } = await readLeague();
  const fresh = () => structuredClone({ s: setup, w });
  const b0 = fresh();
  const before = jobOf("Before", "the league as read", [], b0.s, b0.w);
  const value = valueOf(before);
  const changes = pickChanges(setup, w, value);
  const league = changes.filter((c) => c.kind === "League moves");
  const seen = new Set<number>();
  const injuries = changes
    .filter((c) => c.kind === "Injury news")
    .filter((c) => !seen.has(c.playerId) && seen.add(c.playerId))
    .slice(0, BUSY_INJURIES);
  const day = (label: string, list: typeof changes) => {
    const { s, w: v } = fresh();
    const touched = list.flatMap((c) => applyChange(c, s, v, value).touched);
    return jobOf("Busy day", label, touched, s, v);
  };
  const jobs = [
    before,
    day(`${league.length} rival add/drops`, league),
    day(`${league.length} rival add/drops and ${injuries.length} injury news items`, [
      ...league,
      ...injuries,
    ]),
  ];
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/skip-jobs-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`;
  writeFileSync(file, JSON.stringify(jobs));
  console.log(`saved ${file}`);
  return jobs;
}

async function main() {
  const singles: Job[] = JSON.parse(readFileSync(SINGLES, "utf8"));
  const days = await busyDays();
  for (const [name, jobs] of [
    ["single changes (§11)", singles],
    ["busy days", days],
  ] as const) {
    const had = new Set(jobs[0]!.moves.map((m) => m.key));
    console.log(`\n${name}:`);
    for (const j of jobs.slice(1)) {
      const touched = new Set(j.touched);
      const r = j.moves.filter(
        (m) => !had.has(m.key) || ids(m.key).some((id) => touched.has(id)),
      ).length;
      console.log(
        `${j.kind.padEnd(12)} re-checks ${String(r).padStart(3)} of ${j.moves.length} · ${j.label}`,
      );
    }
  }
  if (process.env.DRY) return;
  if (!process.env.RESULT) throw new Error("RESULT=<the tier guard's result file> is needed");

  const saved: { effects: Effect[][] } = JSON.parse(readFileSync(process.env.RESULT, "utf8"));
  if (saved.effects.length !== singles.length) throw new Error("RESULT isn't for " + SINGLES);
  const singleFx = saved.effects.map((l) => new Map(l.map((e) => [e.key, e])));
  const dayFx = await simulate(days);
  const cases = (jobs: Job[], fx: Map<string, Effect>[]): Case[] =>
    jobs.slice(1).map((job, i) => ({ job, before: jobs[0]!, beforeFx: fx[0]!, full: fx[i + 1]! }));
  const all = [...cases(singles, singleFx), ...cases(days, dayFx)];

  const out = [];
  for (const contenders of CONTENDERS) {
    console.log(
      `\nRe-checking the touched and new moves${contenders ? ` and the last sweep's best ${contenders}` : ""}:`,
    );
    const scored = all.map((c) => ({ c, s: score(c, contenders) }));
    for (const { c, s } of scored) {
      out.push({ contenders, kind: c.job.kind, label: c.job.label, ...s });
      console.log(
        `${s.sameTop ? "same" : "DIFF"} top 5 · off by ${(100 * s.gap).toFixed(2)} points ` +
          `${s.close ? "(within ±0.2)" : "(OVER ±0.2)"} · re-checks ${s.rechecked}/${c.job.moves.length} · ` +
          `${c.job.kind}: ${c.job.label}`,
      );
    }
    // Each kind: its 10 singles, and the busy day it would face (rival moves alone; with news).
    for (const [kind, day, n] of [
      ["League moves", 0, LEAGUE_MOVES],
      ["Injury news", 1, INJURY_NEWS],
    ] as const) {
      const own = scored.filter(({ c }) => c.job.kind === kind);
      const d = scored.filter(({ c }) => c.job.kind === "Busy day")[day]!.s;
      const sameTop = own.filter(({ s }) => s.sameTop).length;
      const close = own.filter(({ s }) => s.close).length;
      const ok = own.length === n && sameTop >= SINGLES_NEEDED && close >= SINGLES_NEEDED;
      console.log(
        `${kind}: top 5 same ${sameTop}/${own.length}, within ±0.2 ${close}/${own.length}, ` +
          `busy day ${d.sameTop && d.close ? "passes" : "fails"}: ` +
          (ok && d.sameTop && d.close ? "PASSES" : "does not pass"),
      );
    }
  }
  writeFileSync(
    `${dir}/skip-result-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`,
    JSON.stringify({ effects: dayFx.map((m) => [...m.values()]), out }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
