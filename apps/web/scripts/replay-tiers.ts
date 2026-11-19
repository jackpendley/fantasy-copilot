// The replay guard for tiered simulation jobs (docs/COMPUTE.md §11, pre-registered before its
// run). A tiered job re-checks only the moves a trigger touches plus the last sweep's contenders
// first (tier B) and shows the last sweep's numbers for the rest until the full sweep (tier C)
// catches up. This asks whether that shows Jack the same best moves as re-running everything.
//
// It reads the league as it stands (ESPN reads only; no database writes), then builds, with the
// production code (simBuildOf, buildSimMoves), the job before and after each of 21 changes of
// the kinds that queue a job: 10 rival add/drops ("League moves"), 10 injury news items on
// Jack's players ("Injury news") and today's first tip ("Tip-off"). Jack's own moves and the
// nightly run sweep everything, so they aren't replayed. Every waiver move of every job is
// played on the same chunks of seasons (runChunk: common random numbers), and for each change:
// - full: every move's numbers after the change;
// - tiered: the after numbers for tier B, the before numbers for the rest;
// - pass when the recommended top 5 (each add's best move, adds ranked by title change) is
//   identical in both, and every move in the full top 10 is in tier B.
//
//   DRY=1 node --env-file=.env.local --conditions=react-server --import tsx scripts/replay-tiers.ts
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/replay-tiers.ts
//   SNAPSHOT=data/local/replay-tiers/<file>.json ... (re-run a saved set of jobs)

import { availableParallelism } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import type { ChunkResult, WireInput, WireMove } from "@fantasy-copilot/fantasy-core";
import type { InjuryReport } from "@fantasy-copilot/nba-data";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { absences } from "../lib/nba/availability";
import { LAST_SCORING_PERIOD, matchupPeriodOf } from "../lib/nba/calendar";
import { loadLeague } from "../lib/nba/data";
import { weekPointsThroughToday } from "../lib/nba/matchup";
import { outlookSetup } from "../lib/nba/outlook-run";
import { CHUNK_SEASONS, REPLAYS, simBuildOf } from "../lib/nba/sim-jobs";
import { GROUP_SIZE, buildSimMoves } from "../lib/nba/sim-moves";
import { valueContext } from "../lib/nba/trade";
import { loadWaiverInputs } from "../lib/nba/waivers-view";

/** Seasons per move in every job (the top tier's minimum, TOP_TIER.minSeasons). */
const SEASONS = 4_000;
const CHUNKS = SEASONS / CHUNK_SEASONS;
/** One core's loop (a worker thread). */
const chunkFile = new URL("./replay-tiers-chunk.ts", import.meta.url).href;
/** Tier B's contenders: the last sweep's best moves by title change (fallback 60, §11). */
const CONTENDERS = [20, 60];
const LEAGUE_MOVES = 10;
const INJURY_NEWS = 10;
/** Injury news: out this many days (cycled); a player already out comes back instead. */
const OUT_DAYS = [2, 7, 21];
/** Rival adds come from this many of the best free agents. */
const ADD_POOL = 15;

type Setup = Awaited<ReturnType<typeof outlookSetup>>;
type Waiver = Awaited<ReturnType<typeof loadWaiverInputs>>;

interface Job {
  kind: "Before" | "League moves" | "Injury news" | "Tip-off";
  label: string;
  /** Players the change is about (tier B takes every move with one of them). */
  touched: number[];
  teamId: number;
  base: WireInput;
  moves: WireMove[];
  /** The first `top` moves are the cards' opening moves (checked to the top tier). */
  top: number;
}

/** A small seeded generator, so the same league picks the same changes. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every player object in the league as read, by id (setup and waiver inputs share them). */
function playersById(s: Setup, w: Waiver, id: number): RosterPlayer[] {
  return [
    ...s.data.teams.flatMap((t) => t.roster),
    ...s.data.me.roster,
    ...w.inputs.roster,
    ...s.freeAgents,
    ...w.inputs.freeAgents.map((f) => f.player),
  ].filter((p) => p.id === id);
}

/** Absences from the injury feed and statuses again, as outlookSetup and the waiver view do. */
function reabsent(s: Setup, w: Waiver) {
  const feed = s.data.injuries;
  w.data.injuries = feed;
  w.inputs.week = { ...w.inputs.week, injuries: feed };
  s.injured = absences([...s.data.teams.flatMap((t) => t.roster), ...s.freeAgents], feed, w.sp);
  w.inputs.season = valueContext(
    w.data.games,
    w.data.settings.slotCounts,
    w.sp,
    LAST_SCORING_PERIOD,
    w.data.settings.regularSeasonWeeks,
    absences([...w.inputs.roster, ...w.inputs.freeAgents.map((f) => f.player)], feed, w.sp),
  );
}

function jobOf(kind: Job["kind"], label: string, touched: number[], s: Setup, w: Waiver): Job {
  const { build } = simBuildOf(s, w, {
    extraKeys: [],
    ideas: [],
    asked: { top: [], rest: [] },
    streamsTop: true,
  });
  const built = buildSimMoves(build);
  return {
    kind,
    label,
    touched,
    teamId: build.teamId,
    base: build.base,
    // Waiver moves only: trade ideas are compared on their own.
    moves: built.moves.filter((m) => !m.key.startsWith("trade:")),
    top: built.top,
  };
}

async function buildJobs(): Promise<Job[]> {
  const [setup, w] = await Promise.all([outlookSetup(), loadWaiverInputs()]);
  // Jack's "Never drop" players as the Moves page lists them (NO_DROP="Name,Name"): kept in
  // production's database, which isn't readable here, and out of the code.
  const noDrop = new Set((process.env.NO_DROP ?? "").split(",").map((n) => n.trim()));
  const kept = w.inputs.roster.filter((p) => noDrop.has(p.name)).map((p) => p.id);
  if (kept.length) w.inputs.noDrop = new Set(kept);
  console.log(`never drop: ${kept.length} of Jack's players`);
  // One clone per change, from the league as read (shared player objects stay shared).
  const fresh = () => structuredClone({ s: setup, w });
  const b0 = fresh();
  const before = jobOf("Before", "the league as read", [], b0.s, b0.w);
  const fppg = new Map(
    [...before.base.teams.flatMap((t) => t.roster), ...before.base.freeAgents].map((p) => [
      p.id,
      p.fppg,
    ]),
  );
  const value = (id: number) => fppg.get(id) ?? 0;
  const jobs = [before];
  const pick = rng(20261119);
  const me = setup.data.me.id;

  // League moves: a rival drops his least valuable player for one of the best free agents.
  const rivals = setup.data.teams.filter((t) => t.id !== me);
  const healthy = (p: RosterPlayer) => !setup.injured.has(p.id);
  const pool = w.inputs.freeAgents
    .map((f) => f.player)
    .filter((p) => healthy(p) && setup.freeAgents.some((x) => x.id === p.id))
    .sort((a, b) => value(b.id) - value(a.id))
    .slice(0, ADD_POOL);
  for (let i = 0; i < LEAGUE_MOVES && pool.length; i++) {
    const team = rivals[Math.floor(pick() * rivals.length)]!;
    const add = pool.splice(Math.floor(pick() * pool.length), 1)[0]!;
    const { s, w: v } = fresh();
    const t = s.data.teams.find((x) => x.id === team.id)!;
    const drop = t.roster
      .filter((p) => p.slot !== "IR")
      .reduce((a, p) => (value(p.id) < value(a.id) ? p : a));
    const added = s.freeAgents.find((p) => p.id === add.id)!;
    t.roster = [...t.roster.filter((p) => p.id !== drop.id), { ...added, slot: "BE" }];
    s.freeAgents = [...s.freeAgents.filter((p) => p.id !== add.id), { ...drop, slot: null }];
    v.inputs.freeAgents = v.inputs.freeAgents.filter((f) => f.player.id !== add.id);
    reabsent(s, v);
    jobs.push(
      jobOf(
        "League moves",
        `Team ${team.id} adds ${add.name}, drops ${drop.name}`,
        [add.id, drop.id],
        s,
        v,
      ),
    );
  }

  // Injury news on Jack's players: one is ruled out (2, 7 or 21 days), or one who's out is back.
  const mine = setup.data.me.roster;
  for (let i = 0; i < INJURY_NEWS; i++) {
    const p = mine[Math.floor(pick() * mine.length)]!;
    const { s, w: v } = fresh();
    const out = setup.injured.has(p.id);
    const feed = s.data.injuries.filter((r) => r.playerId !== p.id);
    let label: string;
    if (out) {
      label = `${p.name} is back`;
      for (const x of playersById(s, v, p.id)) x.injuryStatus = "ACTIVE";
    } else {
      const days = OUT_DAYS[i % OUT_DAYS.length]!;
      const back = new Date(`${v.date}T12:00:00Z`);
      back.setUTCDate(back.getUTCDate() + days);
      const returnDate = back.toISOString().slice(0, 10);
      const report: InjuryReport = {
        playerId: p.id,
        name: p.name,
        teamId: p.proTeamId,
        status: "Out",
        short: "Replay",
        long: "Replay",
        date: new Date().toISOString(),
        returnDate,
      };
      feed.push(report);
      for (const x of playersById(s, v, p.id)) x.injuryStatus = "OUT";
      label = `${p.name} out until ${returnDate}`;
    }
    s.data.injuries = feed;
    reabsent(s, v);
    jobs.push(jobOf("Injury news", label, [p.id], s, v));
  }

  // Today's first tip: moves count from tomorrow (as outlookSetup and the waiver view read
  // rosters right after it).
  if (setup.fromDay === w.sp) {
    const { s, w: v } = fresh();
    const today = w.sp;
    const league = await loadLeague(today, v.date);
    const games = v.data.games.filter((g) => g.scoringPeriodId === today);
    const first = Math.min(...games.map((g) => g.date));
    const started = new Set(
      games.filter((g) => g.date === first).flatMap((g) => [g.homeProTeamId, g.awayProTeamId]),
    );
    s.fromDay = today + 1;
    s.bankedNow = { period: matchupPeriodOf(today), points: weekPointsThroughToday(league, today) };
    v.inputs.rosterLocked = true;
    v.inputs.tips?.delete(today);
    v.inputs.startedToday = started;
    v.inputs.lockedToday = new Set(
      v.inputs.roster.filter((p) => started.has(p.proTeamId)).map((p) => p.id),
    );
    jobs.push(jobOf("Tip-off", "today's first game tipped", [], s, v));
  }
  return jobs;
}

/** A move's title change and its standard error, from its summed chunks. */
interface Effect {
  key: string;
  n: number;
  d: number;
  se: number;
}

/** Play every move of every job on chunks 0..CHUNKS-1, on all cores. */
async function simulate(jobs: Job[]): Promise<Map<string, Effect>[]> {
  const tasks = jobs.flatMap((j, ji) =>
    Array.from({ length: Math.ceil(j.moves.length / GROUP_SIZE) }, (_, g) =>
      Array.from({ length: CHUNKS }, (_, chunk) => ({
        ji,
        moves: j.moves.slice(g * GROUP_SIZE, (g + 1) * GROUP_SIZE),
        chunk,
      })),
    ).flat(),
  );
  const sums = jobs.map(() => new Map<string, { n: number; s: number; q: number }>());
  const cores = availableParallelism();
  const t0 = Date.now();
  let done = 0;
  let next = 0;
  const pool = Array.from(
    { length: cores },
    // TypeScript in the worker threads too: they don't inherit tsx, so each registers it first.
    () =>
      new Worker(
        `import("tsx/esm/api").then((t) => { t.register(); return import(${JSON.stringify(chunkFile)}); })`,
        { eval: true },
      ),
  );
  await Promise.all(
    pool.map(async (w) => {
      while (next < tasks.length) {
        const t = tasks[next++]!;
        const j = jobs[t.ji]!;
        const r = await new Promise<ChunkResult>((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
          w.postMessage({
            setup: j.base,
            teamId: j.teamId,
            moves: t.moves,
            chunk: t.chunk,
            seasons: CHUNK_SEASONS,
            replays: REPLAYS,
          });
        });
        w.removeAllListeners("error");
        for (const [key, m] of Object.entries(r.moves)) {
          const a = sums[t.ji]!.get(key) ?? { n: 0, s: 0, q: 0 };
          sums[t.ji]!.set(key, {
            n: a.n + m.title.n,
            s: a.s + m.title.sum,
            q: a.q + m.title.sumsq,
          });
        }
        if (++done % 100 === 0)
          console.error(
            `${done}/${tasks.length} chunks, ${Math.round((Date.now() - t0) / 1000)} s`,
          );
      }
      await w.terminate();
    }),
  );
  return sums.map(
    (m) =>
      new Map(
        [...m].map(([key, a]) => {
          const d = a.s / a.n;
          return [key, { key, n: a.n, d, se: Math.sqrt(Math.max(a.q / a.n - d * d, 0) / a.n) }];
        }),
      ),
  );
}

const ids = (key: string) => key.split(":").filter(Boolean).map(Number);
const addOf = (key: string) => key.split(":")[0]!;

/** The recommended top 5: each add's best move, adds ranked by its title change. */
function top5(effects: Effect[]): string[] {
  const best = new Map<string, Effect>();
  for (const e of effects) {
    const b = best.get(addOf(e.key));
    if (!b || e.d > b.d) best.set(addOf(e.key), e);
  }
  return [...best.values()]
    .sort((a, b) => b.d - a.d)
    .slice(0, 5)
    .map((e) => e.key);
}

/** Tier B for a change: touched, new, the cards' opening moves, and the last sweep's best. */
function tierB(job: Job, before: Job, beforeFx: Map<string, Effect>, contenders: number) {
  const had = new Set(before.moves.map((m) => m.key));
  const touched = new Set(job.touched);
  const best = [...beforeFx.values()]
    .sort((a, b) => b.d - a.d)
    .slice(0, contenders)
    .map((e) => e.key);
  return new Set([
    ...job.moves.filter((m) => ids(m.key).some((id) => touched.has(id))).map((m) => m.key),
    ...job.moves.filter((m) => !had.has(m.key)).map((m) => m.key),
    ...job.moves.slice(0, job.top).map((m) => m.key),
    ...best.filter((k) => job.moves.some((m) => m.key === k)),
  ]);
}

async function main() {
  const dir = "data/local/replay-tiers";
  let jobs: Job[];
  if (process.env.SNAPSHOT) jobs = JSON.parse(readFileSync(process.env.SNAPSHOT, "utf8"));
  else {
    jobs = await buildJobs();
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/jobs-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`;
    writeFileSync(file, JSON.stringify(jobs));
    console.log(`saved ${file}`);
  }
  const before = jobs[0]!;
  const groups = jobs.reduce((a, j) => a + Math.ceil(j.moves.length / GROUP_SIZE), 0);
  console.log(
    `${jobs.length - 1} changes; ${jobs.reduce((a, j) => a + j.moves.length, 0)} moves; ` +
      `${groups * CHUNKS} chunks of ${CHUNK_SEASONS} seasons`,
  );
  for (const j of jobs) {
    const had = new Set(before.moves.map((m) => m.key));
    console.log(
      `${j.kind.padEnd(12)} ${String(j.moves.length).padStart(4)} moves, top ${j.top}, ` +
        `${j.moves.filter((m) => !had.has(m.key)).length} new · ${j.label}`,
    );
  }
  if (process.env.DRY) return;

  const fx = await simulate(jobs);
  const beforeFx = fx[0]!;
  const out = [];
  for (const contenders of CONTENDERS) {
    console.log(`\nTier B with the last sweep's best ${contenders}:`);
    let pass = 0;
    let covered = 0;
    for (const [i, job] of jobs.entries()) {
      if (i === 0) continue;
      const full = fx[i]!;
      const b = tierB(job, before, beforeFx, contenders);
      const tiered = job.moves
        .map((m) => (b.has(m.key) ? full.get(m.key) : beforeFx.get(m.key)))
        .filter((e): e is Effect => e != null);
      const fullTop = top5([...full.values()]);
      const tieredTop = top5(tiered);
      const same = fullTop.join() === tieredTop.join();
      const top10 = [...full.values()]
        .sort((x, y) => y.d - x.d)
        .slice(0, 10)
        .map((e) => e.key);
      const missing = top10.filter((k) => !b.has(k));
      pass += Number(same);
      covered += Number(!missing.length);
      out.push({
        contenders,
        kind: job.kind,
        label: job.label,
        b: b.size,
        same,
        fullTop,
        tieredTop,
        missing,
      });
      console.log(
        `${same ? "same" : "DIFF"} top 5 · ${missing.length ? `${missing.length} of the top 10 outside B` : "top 10 in B"} · ` +
          `B ${b.size}/${job.moves.length} · ${job.kind}: ${job.label}`,
      );
    }
    const n = jobs.length - 1;
    const ok = pass / n >= 0.95 && covered === n;
    console.log(
      `top 5 identical ${pass}/${n} (${((100 * pass) / n).toFixed(0)}%), top 10 in B ${covered}/${n}: ` +
        (ok ? "PASSES" : "does not pass"),
    );
  }
  writeFileSync(
    `${dir}/result-${new Date().toISOString().slice(0, 16).replace(":", "")}.json`,
    JSON.stringify({ seasons: SEASONS, effects: fx.map((m) => [...m.values()]), out }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
