// The replay test for a shorter race on triggered jobs (docs/COMPUTE.md §14, pre-registered
// before its run). Today Jack's best move and up to three moves not clearly behind it race to
// ±0.1 title points (the decision tier, up to 160,000 seasons: about half of a job's work). The
// candidate stops them at the top tier's ±0.2 (up to 40,000), which every card's opening move
// already gets. Does Jack's #1 change, and by how much in the full race's own numbers?
//
// For each of 12 saved league states, the 20 best waiver moves after 4,000 seasons are checked
// by production's own rules (lib/nba/deep-check.ts: effectsFromSums, promotions, racingTargets,
// head to head by chunk), on production's chunk seeds, twice: as today, and with the race at
// the top tier. A chunk's numbers depend only on its index, so both runs share them.
//
//   DRY=1 node --conditions=react-server --import tsx scripts/replay-race.ts
//   node --conditions=react-server --import tsx scripts/replay-race.ts

import { availableParallelism } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import type { ChunkResult } from "@fantasy-copilot/fantasy-core";
import {
  DECISION_TIER,
  TOP_TIER,
  effectsFromSums,
  headToHeadOf,
  promotions,
  racingTargets,
  type ChunkMeans,
  type DeepEffect,
  type MoveSums,
  type Tier,
} from "../lib/nba/deep-check";
import { CHUNK_SEASONS, REPLAYS } from "../lib/nba/sim-jobs";
import { GROUP_SIZE } from "../lib/nba/sim-moves";
import type { Effect, Job } from "./replay-tiers";

const dir = "data/local/replay-tiers";
/** The 20 best waiver moves after 4,000 seasons (the first 8 chunks). */
const CONTENDERS = 20;
const START_CHUNKS = TOP_TIER.minSeasons / CHUNK_SEASONS;
/** Chunks a move still getting seasons takes between refreshes (production has more in flight). */
const ROUND = 16;
/** The candidate passes when its #1 is within this of the full race's #1, in its numbers... */
const CLOSE = 0.001;
/** ...in at least this many of the 12 states, and within LIMIT in all of them. */
const CLOSE_NEEDED = 11;
const LIMIT = 0.002;
const chunkFile = new URL("./replay-tiers-chunk.ts", import.meta.url).href;

/** The 12 league states (pre-registered): a saved job and the 4,000-season numbers it had. */
const STATES: { jobs: string; result: string; index: number }[] = [
  ...[0, 1, 2, 3, 4, 11, 12, 13, 14].map((index) => ({
    jobs: `${dir}/jobs-2026-11-19T1652.json`,
    result: `${dir}/result-2026-11-19T2243.json`,
    index,
  })),
  ...[0, 1, 2].map((index) => ({
    jobs: `${dir}/skip-jobs-2026-11-19T2018.json`,
    result: `${dir}/skip-result-2026-11-19T2325.json`,
    index,
  })),
];

interface Task {
  job: Job;
  moves: Job["moves"];
  chunk: number;
}

function pool() {
  const workers = Array.from(
    { length: availableParallelism() },
    // TypeScript in the worker threads too: they don't inherit tsx, so each registers it first.
    () =>
      new Worker(
        `import("tsx/esm/api").then((t) => { t.register(); return import(${JSON.stringify(chunkFile)}); })`,
        { eval: true },
      ),
  );
  const run = async (tasks: Task[]): Promise<ChunkResult[]> => {
    const out: ChunkResult[] = [];
    let next = 0;
    await Promise.all(
      workers.map(async (w) => {
        while (next < tasks.length) {
          const t = tasks[next++]!;
          out.push(
            await new Promise<ChunkResult>((resolve, reject) => {
              w.once("message", resolve);
              w.once("error", reject);
              w.postMessage({
                setup: t.job.base,
                teamId: t.job.teamId,
                moves: t.moves,
                chunk: t.chunk,
                seasons: CHUNK_SEASONS,
                replays: REPLAYS,
              });
            }),
          );
          w.removeAllListeners("error");
        }
      }),
    );
    return out;
  };
  return { run, close: () => Promise.all(workers.map((w) => w.terminate())) };
}

/** Every (move, chunk) played so far in a state: a chunk's numbers depend only on its index. */
type Cache = Map<string, Map<number, ChunkResult["moves"][string]>>;

async function play(
  cache: Cache,
  job: Job,
  need: Map<string, number[]>,
  run: (t: Task[]) => Promise<ChunkResult[]>,
) {
  const byChunk = new Map<number, string[]>();
  for (const [key, chunks] of need)
    for (const c of chunks)
      if (!cache.get(key)?.has(c)) byChunk.set(c, [...(byChunk.get(c) ?? []), key]);
  const tasks: Task[] = [];
  for (const [chunk, keys] of byChunk)
    for (let i = 0; i < keys.length; i += GROUP_SIZE) {
      const ks = new Set(keys.slice(i, i + GROUP_SIZE));
      tasks.push({ job, moves: job.moves.filter((m) => ks.has(m.key)), chunk });
    }
  for (const r of await run(tasks))
    for (const [key, m] of Object.entries(r.moves)) {
      if (!cache.has(key)) cache.set(key, new Map());
      cache.get(key)!.set(r.chunk, m);
    }
}

/**
 * Production's racing on these moves, to the end: each refresh computes effects at each move's
 * tier, promotes (sticky), lowers moves out of their race, and gives every move still getting
 * seasons its next ROUND chunks. `decision`: the race's tier (the candidate: the top tier).
 */
async function race(
  cache: Cache,
  job: Job,
  keys: string[],
  decision: Tier,
  run: (t: Task[]) => Promise<ChunkResult[]>,
) {
  const played = new Map(keys.map((k) => [k, START_CHUNKS]));
  const promoted = new Map<string, Tier>();
  await play(
    cache,
    job,
    new Map(keys.map((k) => [k, Array.from({ length: START_CHUNKS }, (_, c) => c)])),
    run,
  );
  for (let round = 0; ; round++) {
    // SMOKE: timing only (no numbers printed), three rounds.
    if (process.env.SMOKE && round === 3) return { effects: [], seasons: 0 };
    const sums = new Map<string, MoveSums>();
    const means: ChunkMeans = new Map();
    for (const k of keys) {
      const per = [...cache.get(k)!].filter(([c]) => c < played.get(k)!);
      const add = (m: "title" | "playoffs" | "seed1" | "bye" | "wins") =>
        per.reduce(
          (a, [, x]) => ({ n: a.n + x[m].n, sum: a.sum + x[m].sum, sumsq: a.sumsq + x[m].sumsq }),
          { n: 0, sum: 0, sumsq: 0 },
        );
      sums.set(k, {
        title: add("title"),
        playoffs: add("playoffs"),
        seed1: add("seed1"),
        bye: add("bye"),
        wins: add("wins"),
      });
      means.set(
        k,
        new Map(
          per.map(([c, x]) => [c, { title: x.title.sum / x.title.n, wins: x.wins.sum / x.wins.n }]),
        ),
      );
    }
    const h2h = headToHeadOf(means);
    const tierOf = (lowered?: Map<string, Tier>) => (k: string) => {
      const t = promoted.get(k) ?? TOP_TIER;
      return { ...t, target2se: lowered?.get(k)?.target2se ?? t.target2se };
    };
    let effects = effectsFromSums(keys, sums, tierOf());
    for (const [k, t] of promotions(effects, tierOf(), h2h))
      promoted.set(k, t.maxSeasons >= DECISION_TIER.maxSeasons ? decision : t);
    effects = effectsFromSums(keys, sums, tierOf());
    const lowered = racingTargets(effects, (k) => promoted.get(k) ?? null, h2h);
    effects = effectsFromSums(keys, sums, tierOf(lowered));
    const active = effects.filter((e) => e.active);
    if (!active.length)
      return { effects, seasons: [...played.values()].reduce((a, n) => a + n, 0) * CHUNK_SEASONS };
    const need = new Map<string, number[]>();
    for (const e of active) {
      const from = played.get(e.key)!;
      const to = Math.min(
        from + ROUND,
        (promoted.get(e.key) ?? TOP_TIER).maxSeasons / CHUNK_SEASONS,
      );
      need.set(
        e.key,
        Array.from({ length: to - from }, (_, i) => from + i),
      );
      played.set(e.key, to);
    }
    await play(cache, job, need, run);
  }
}

/** Jack's #1: the most title odds among waiver moves still in play. */
const first = (effects: DeepEffect[]) =>
  effects.filter((e) => !e.dropped && e.seasons > 0).sort((a, b) => b.title.d - a.title.d)[0]!;

async function main() {
  const states = STATES.map((s) => {
    const jobs: Job[] = JSON.parse(readFileSync(s.jobs, "utf8"));
    const fx: Effect[][] = JSON.parse(readFileSync(s.result, "utf8")).effects;
    const job = jobs[s.index]!;
    const keys = [...fx[s.index]!]
      .filter((e) => job.moves.some((m) => m.key === e.key))
      .sort((a, b) => b.d - a.d)
      .slice(0, CONTENDERS)
      .map((e) => e.key);
    return { label: `${job.kind}: ${job.label}`, job, keys };
  });
  for (const s of states) console.log(`${s.keys.length} moves · ${s.label}`);
  if (process.env.DRY) return;

  const p = pool();
  if (process.env.SMOKE) {
    const s = states[0]!;
    const t = Date.now();
    const cache: Cache = new Map();
    await race(cache, s.job, s.keys.slice(0, 4), DECISION_TIER, p.run);
    const chunks = [...cache.values()].reduce((a, m) => a + m.size, 0);
    console.log(`smoke: ${chunks} move-chunks in ${((Date.now() - t) / 1000).toFixed(0)} s`);
    await p.close();
    return;
  }
  const out = [];
  let close = 0;
  let within = 0;
  const t0 = Date.now();
  for (const s of states) {
    const cache: Cache = new Map();
    const full = await race(cache, s.job, s.keys, DECISION_TIER, p.run);
    const short = await race(cache, s.job, s.keys, TOP_TIER, p.run);
    const a = first(full.effects);
    const b = first(short.effects);
    const fullOf = new Map(full.effects.map((e) => [e.key, e]));
    const loss = a.title.d - fullOf.get(b.key)!.title.d;
    close += Number(loss <= CLOSE);
    within += Number(loss <= LIMIT);
    out.push({
      label: s.label,
      fullFirst: a.key,
      shortFirst: b.key,
      loss,
      seasonsFull: full.seasons,
      seasonsShort: short.seasons,
      full: full.effects.map((e) => ({ key: e.key, d: e.title.d, se: e.title.se, n: e.seasons })),
      short: short.effects.map((e) => ({ key: e.key, d: e.title.d, se: e.title.se, n: e.seasons })),
    });
    console.log(
      `${a.key === b.key ? "same #1" : "DIFF #1"} · loss ${(100 * loss).toFixed(3)} points · seasons ` +
        `${full.seasons} → ${short.seasons} (−${Math.round((100 * (full.seasons - short.seasons)) / full.seasons)}%) · ` +
        `${Math.round((Date.now() - t0) / 60_000)} min · ${s.label}`,
    );
  }
  await p.close();
  const n = states.length;
  console.log(
    `within ±0.1 of the full race's #1: ${close}/${n} (need ${CLOSE_NEEDED}); within ±0.2: ${within}/${n} (need ${n}): ` +
      (close >= CLOSE_NEEDED && within === n ? "PASSES" : "does not pass"),
  );
  writeFileSync(
    `${dir}/race-result-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`,
    JSON.stringify(out),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
