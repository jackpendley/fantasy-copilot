import "server-only";
// Season simulations on the GitHub Actions worker (ADR-053). Vercel builds a job, the season as
// it stands (the base run, i.e. the Outlook) plus every candidate waiver move (ADR-058), as
// plain JSON. The moves are split into groups of 12, most important first; runners take a
// group's chunks of 500 seasons, post back paired results, and the Outlook and the Moves checks
// update from the sums. Moves stop getting seasons once their title change is known to their
// tier's precision (ADR-060: ±0.35 points for the moves Jack acts on, ±1 for the rest); clearly
// worse moves stop early.

import {
  toWire,
  type ChunkResult,
  type SimTeamResult,
  type WireInput,
  type WireMove,
} from "@fantasy-copilot/fantasy-core";
import { db, dbConfigured } from "@/lib/db";
import { fingerprintOf, readView, writeView } from "@/lib/view-cache";
import {
  MIN_BASE_SEASONS,
  REST_TIER,
  TOP_TIER,
  contendersOf,
  effectsFromSums,
  withPBest,
  type DeepEffect,
  type MoveSums,
  type Tier,
} from "./deep-check";
import { CpuMeter } from "@/lib/cpu";
import { addAskedTrades, pendingAskedTrades } from "./asked-trades";
import { dispatchWorker } from "./github-dispatch";
import type { StoredIdea } from "./trade-task";
import { rosterKeyOf, watchKeyOf, watchedFreeAgents } from "./move-checks";
import {
  chooseShown,
  deepView,
  type DeepView,
  type LiveJob,
  type SettledResult,
  type ShownState,
} from "./move-shown";
import { buildOutlookInput } from "./outlook";
import { outlookSetup, type OutlookTeam } from "./outlook-run";
import {
  TRADE_MOVES,
  buildSimMoves,
  groupsOf,
  hasChunksLeft,
  pickGroup,
  type SimBuildInput,
  type SimGroup,
  type TradeSpec,
} from "./sim-moves";
import { loadWaiverInputs } from "./waivers-view";
import { SIM_LOCK, enqueueTask, hasTasks, heartbeat } from "./worker-tasks";
import { saverOn } from "@/lib/cpu-saver";
import { decodeWire, encodeWire } from "@/lib/wire-json";

/**
 * Seasons per chunk. Each runner request carries 2 chunks per core, so bigger chunks mean fewer
 * requests to Vercel per job (500 from Nov 6, was 200: a round takes ~12 s, not ~5).
 */
export const CHUNK_SEASONS = 500;
export const REPLAYS = 10;
/** The most any group can take (its own tier's limit is stored with it). */
const MAX_CHUNKS = TOP_TIER.maxSeasons / CHUNK_SEASONS;
const MIN_BASE_CHUNKS = MIN_BASE_SEASONS / CHUNK_SEASONS;
/**
 * Runners' posts recompute the checks at most this often (and whenever all are back): each
 * recompute rewrites every move's numbers, the biggest part of a post's Vercel CPU (Nov 5:
 * ~10 s of a job's ~15 s). Numbers on the page lag by at most this plus its 10 s poll.
 */
const REFRESH_GAP_S = 20;
/** Under the CPU saver (lib/cpu-saver.ts). */
const SAVER_REFRESH_GAP_S = 45;
/** A job whose runners stopped posting is closed with what it has after this long. */
const STALE_MS = 4 * 60_000;
export const DEEP_KEY = "move-checks-deep";
/** Stored trade ideas (lib/nba/trade-view.ts). */
const TRADE_VIEW = "trade-targets";

/** What the Moves page shows from a deep check. */
export interface DeepChecks {
  jobId: number;
  rosterKey: string;
  waiverFingerprint: string;
  /** Seasons in the base run so far (the most any move has). */
  seasons: number;
  base: { title: number; playoffs: number; seed1: number; bye: number; wins: number };
  effects: DeepEffect[];
  final: boolean;
  at: string;
}

interface JobRow {
  id: number;
  status: string;
  trigger: string | null;
  team_id: number;
  scoring_period: number;
  read_at: Date;
  waiver_fingerprint: string | null;
  roster_key: string | null;
  replays: number;
  chunk_seasons: number;
  max_chunks: number;
  outlook_run_id: number | null;
  meta: OutlookTeam[];
}

type GroupRow = SimGroup & {
  keys: string[];
  active: string[];
  target_2se: number;
  min_seasons: number;
  max_seasons: number;
};

const groupHasWork = (g: SimGroup) => hasChunksLeft(g, MIN_BASE_CHUNKS);

/**
 * Queue the season as it stands now for the worker, and start it. `extraKeys`: moves Jack asked
 * to check (a drop he picked). Returns the job id (an identical queued or finished job is reused).
 */
export async function enqueueSimJob(
  trigger: string | null,
  extraKeys: string[] = [],
  m = new CpuMeter(),
): Promise<number | null> {
  if (!dbConfigured()) return null;
  const { build, ctx } = await prepareJob(trigger, extraKeys, m);
  if (process.env.WORKER_SECRET) {
    // The worker runs the analysis and builds the moves (docs/COMPUTE.md); the job is stored
    // when it posts them (storeBuiltJob).
    const input = { build: encodeWire(build), ctx };
    await m.step("queue-build", () => enqueueTask("sim-build", fingerprintOf(input), input));
    return null;
  }
  const built = await m.step("build-moves", () => buildSimMoves(build));
  return m.step("store", () => storeJob(ctx, build.base, built));
}

/** The job's own facts, kept with its build task until the moves come back. */
interface JobContext {
  trigger: string | null;
  teamId: number;
  scoringPeriod: number;
  readAt: string;
  rosterKey: string;
  waiverFingerprint: string;
  /** Jack's watch list (watchKeyOf); absent on builds queued before it existed. */
  watchKey?: string;
  meta: OutlookTeam[];
}

/**
 * The season as it stands (the base run as plain JSON) and everything the moves are built from:
 * the add-and-drop analysis' inputs, Jack's roster, the free agents and the stored trade ideas.
 */
async function prepareJob(trigger: string | null, extraKeys: string[], m: CpuMeter) {
  // Read and parsed together (both read the league): one step.
  const [setup, w] = await m.step("inputs", () =>
    Promise.all([outlookSetup(), loadWaiverInputs()]),
  );
  const { data } = setup;
  const base = buildOutlookInput({
    teams: data.teams,
    previousTeams: setup.previousTeams,
    freeAgents: setup.freeAgents,
    games: data.games,
    matchups: data.matchups,
    slotCounts: data.settings.slotCounts,
    addCapPerWeek: data.settings.addsPerWeek ?? 3,
    regularWeeks: data.settings.regularSeasonWeeks,
    fromDay: setup.fromDay,
    bankedNow: setup.bankedNow,
    injured: setup.injured,
    seasons: 0,
  });
  // The best stored trade ideas too, checked after the Moves page's drops.
  const ideas = ((await readView<StoredIdea[]>(TRADE_VIEW).catch(() => null))?.value ?? []).slice(
    0,
    TRADE_MOVES,
  );
  // Trades Jack asked to check, until each has a result.
  const pending = await pendingAskedTrades().catch(() => []);
  const asked = {
    top: pending.filter((a) => a.top).map((a) => a.spec),
    rest: pending.filter((a) => !a.top).map((a) => a.spec),
  };
  const build: SimBuildInput = {
    waiver: w.inputs,
    extraKeys,
    streamsTop: !saverOn(),
    base: toWire(base.input),
    teamId: data.me.id,
    roster: data.me.roster,
    freeAgents: setup.freeAgents,
    games: data.games,
    slotCounts: data.settings.slotCounts,
    fromDay: setup.fromDay,
    regularWeeks: data.settings.regularSeasonWeeks,
    injured: setup.injured,
    injuries: data.injuries,
    teams: data.teams.map((t) => ({ id: t.id, roster: t.roster })),
    ideas,
    asked,
  };
  const key = rosterKeyOf(w.data.ahead.me.roster, w.data.injuries);
  const ctx: JobContext = {
    trigger,
    teamId: data.me.id,
    scoringPeriod: setup.fromDay,
    readAt: setup.readAt.toISOString(),
    rosterKey: key,
    waiverFingerprint: fingerprintOf({ sp: w.sp, key }),
    watchKey: watchKeyOf(watchedFreeAgents(data.me.watchList, data.teams)),
    meta: data.teams.map((t) => {
      const a = base.activity.get(t.id)!;
      return {
        teamId: t.id,
        name: t.name,
        wins: t.wins,
        losses: t.losses,
        pointsFor: t.pointsFor,
        expWins: 0,
        playoffs: 0,
        seed1: 0,
        final: 0,
        champ: 0,
        act: a.act,
        addsPerWeek: a.addsPerWeek,
      };
    }),
  };
  return { build, ctx };
}

/**
 * The worker built a job's moves (a sim-build task): store the job, unless a newer build has
 * been asked for since (its job will replace this one).
 */
export async function storeBuiltJob(
  taskId: number,
  built: { moves: WireMove[]; leading: number; top?: number; others: number },
): Promise<number | null> {
  const [newer] = await db()`
    select 1 from worker_tasks where kind = 'sim-build' and id > ${taskId}
      and status in ('queued', 'running', 'done') limit 1
  `;
  if (newer) return null;
  // Only the job's context and the base season (finishTask kept them; the rest is cleared).
  const [t] = await db()<{ ctx: JobContext; base: unknown }[]>`
    select input->'ctx' as ctx, input->'base' as base from worker_tasks where id = ${taskId}
  `;
  if (!t?.ctx || !t.base) return null;
  return storeJob(t.ctx, decodeWire<WireInput>(t.base), built);
}

async function storeJob(
  ctx: JobContext,
  wire: WireInput,
  { moves, leading, top = 0 }: { moves: WireMove[]; leading: number; top?: number },
) {
  const fingerprint = fingerprintOf({ wire, moves: moves.map((m) => m.key) });
  const [same] = await db()<{ id: number; status: string }[]>`
    select id, status from sim_jobs where fingerprint = ${fingerprint}
      and status in ('queued', 'running', 'done') order by id desc limit 1
  `;
  if (same) {
    // The same simulation: reuse it, under Jack's roster key as it reads now (news that didn't
    // change the simulation, or a new key format), so the roster check doesn't queue it again.
    await db()`
      update sim_jobs set roster_key = ${ctx.rosterKey}, waiver_fingerprint = ${ctx.waiverFingerprint},
        watch_key = ${ctx.watchKey ?? null}
      where id = ${same.id}
    `;
    if (same.status !== "done") await startWorker();
    return same.id;
  }
  await db()`update sim_jobs set status = 'superseded', updated_at = now()
    where status in ('queued', 'running')`;
  const [row] = await db()<{ id: number }[]>`
    insert into sim_jobs ${db()({
      trigger: ctx.trigger,
      team_id: ctx.teamId,
      scoring_period: ctx.scoringPeriod,
      read_at: new Date(ctx.readAt),
      fingerprint,
      setup: db().json(wire as never),
      moves: db().json(moves as never),
      waiver_fingerprint: ctx.waiverFingerprint,
      roster_key: ctx.rosterKey,
      watch_key: ctx.watchKey ?? null,
      replays: REPLAYS,
      chunk_seasons: CHUNK_SEASONS,
      max_chunks: MAX_CHUNKS,
      active: [],
      meta: db().json(ctx.meta as never),
    })}
    returning id
  `;
  // The opening moves (and any Jack asked for) get the first groups and their seasons first;
  // the moves he acts on are checked to the top tier's precision (ADR-060).
  const groups = groupsOf(
    moves.map((m) => m.key),
    top,
  );
  let start = 0;
  const rows = groups.map((keys, grp) => {
    const tier: Tier = start < top ? TOP_TIER : REST_TIER;
    const row_ = {
      job_id: row!.id,
      grp,
      prio: start < leading ? 1 : 2,
      keys,
      active: keys,
      target_2se: tier.target2se,
      min_seasons: tier.minSeasons,
      // Group 0 also carries the base run (the Outlook) to its minimum.
      max_seasons: grp === 0 ? Math.max(tier.maxSeasons, MIN_BASE_SEASONS) : tier.maxSeasons,
    };
    start += keys.length;
    return row_;
  });
  await db()`insert into sim_groups ${db()(rows)}`;
  await startWorker();
  return row!.id;
}

/**
 * Start the worker unless simulation runners are already working (they pick up the newest job)
 * or waiting for a job being built (they take it when it's stored).
 */
async function startWorker() {
  const [busy] = await db()`
    select 1 from sim_jobs where last_worker_at > now() - interval '45 seconds'
    union all
    select 1 from job_locks where name = ${SIM_LOCK} and until > now()
    limit 1
  `;
  if (!busy) await dispatchWorker().catch(() => false);
}

/** Is there work for a runner? (Cheap: one query.) */
export async function hasWork(): Promise<boolean> {
  const rows = await db()`
    select 1 from sim_jobs j join sim_groups g on g.job_id = j.id
    where j.status in ('queued', 'running') and g.next_chunk < g.max_seasons / j.chunk_seasons
      and (cardinality(g.active) > 0 or (g.grp = 0 and g.next_chunk < ${MIN_BASE_CHUNKS}))
    limit 1
  `;
  return rows.length > 0;
}

export interface Assignment {
  jobId: number;
  group: number;
  teamId: number;
  replays: number;
  chunkSeasons: number;
  chunks: number[];
  active: string[];
  /** Only when the runner doesn't have this job (or all its moves) yet. */
  setup?: WireInput;
  moves?: WireMove[];
}

/**
 * Hand a runner its next chunks of the newest live job, for the most important group under its
 * limit of chunks out (none when nothing's left to run). `have`/`haveMoves`: the job and how
 * many of its moves the runner holds, so the input isn't sent again.
 */
export async function nextAssignment(
  count: number,
  have: number | null,
  haveMoves: number | null = null,
): Promise<Assignment | null> {
  // Small rows only: this runs for every assignment (Vercel CPU, docs/COMPUTE.md).
  const [job] = await db()<
    {
      id: number;
      team_id: number;
      replays: number;
      chunk_seasons: number;
      max_chunks: number;
    }[]
  >`
    select id, team_id, replays, chunk_seasons, max_chunks
    from sim_jobs where status in ('queued', 'running')
    order by id desc limit 1
  `;
  if (!job) return null;
  const groups = await db()<(SimGroup & { n_keys: number })[]>`
    select grp, prio, cardinality(active) as n_active, cardinality(keys) as n_keys, next_chunk,
      posted, min_seasons / ${job.chunk_seasons} as min_chunks,
      max_seasons / ${job.chunk_seasons} as max_chunks
    from sim_groups where job_id = ${job.id} order by prio, grp
  `;
  const g = pickGroup(groups, MIN_BASE_CHUNKS);
  if (!g) return null;
  // Atomic and never capped, so concurrent runners get disjoint chunks; past the cap is ignored.
  const [taken] = await db()<{ next_chunk: number; active: string[] }[]>`
    update sim_groups set next_chunk = next_chunk + ${count}
    where job_id = ${job.id} and grp = ${g.grp} and next_chunk < ${g.max_chunks}
    returning next_chunk, active
  `;
  if (!taken) return null;
  await db()`
    update sim_jobs set status = 'running', last_worker_at = now(), updated_at = now()
    where id = ${job.id}
  `;
  const chunks = Array.from({ length: count }, (_, i) => taken.next_chunk - count + i).filter(
    (c) => c < g.max_chunks,
  );
  const nMoves = groups.reduce((a, x) => a + x.n_keys, 0);
  const fresh = have !== job.id || (haveMoves != null && haveMoves !== nMoves);
  const [input] = fresh
    ? await db()<{ setup: WireInput; moves: WireMove[] }[]>`
        select setup, moves from sim_jobs where id = ${job.id}
      `
    : [];
  return {
    jobId: job.id,
    group: g.grp,
    teamId: job.team_id,
    replays: job.replays,
    chunkSeasons: job.chunk_seasons,
    chunks,
    active: taken.active,
    ...(input ? { setup: input.setup, moves: input.moves } : {}),
  };
}

/**
 * A runner's next chunks, or what to do instead: "wait" while a job is being built (a task is
 * under way; the runner asks again later), "leave" when there's nothing.
 */
export async function assignOrWait(
  count: number,
  have: number | null,
  haveMoves: number | null,
): Promise<Assignment | "wait" | "leave"> {
  const cpu0 = process.cpuUsage();
  const a = await nextAssignment(count, have, haveMoves);
  if (a) {
    await addJobCpu(a.jobId, cpu0);
    return a;
  }
  if (!(await hasTasks())) return "leave";
  // Waiting runners count as busy, so the job they wait for doesn't start another run. Short,
  // so a runner that leaves doesn't hold it long (waiting runners ask every 20 s).
  await heartbeat(SIM_LOCK, 30);
  return "wait";
}

/** The group a chunk is for, when a runner from before groups doesn't say. */
export async function groupOf(jobId: number, result: ChunkResult): Promise<number> {
  const key = Object.keys(result.moves)[0];
  if (!key) return 0;
  const [g] = await db()<{ grp: number }[]>`
    select grp from sim_groups where job_id = ${jobId} and ${key} = any(keys) limit 1
  `;
  return g?.grp ?? 0;
}

/**
 * Store a runner's chunks: each move's sums, and the base run's (the same in every group, so
 * the first copy of a chunk counts). The checks update when every chunk out is back, and
 * otherwise at most every few seconds.
 */
export async function postChunks(
  jobId: number,
  group: number,
  results: ChunkResult[],
): Promise<{ done: boolean }> {
  const rows = results.flatMap((r) =>
    Object.entries(r.moves).map(([key, m]) => ({
      job_id: jobId,
      key,
      chunk: r.chunk,
      n: m.title.n,
      title_s: m.title.sum,
      title_q: m.title.sumsq,
      playoffs_s: m.playoffs.sum,
      playoffs_q: m.playoffs.sumsq,
      seed1_s: m.seed1.sum,
      seed1_q: m.seed1.sumsq,
      bye_s: m.bye.sum,
      bye_q: m.bye.sumsq,
      wins_s: m.wins.sum,
      wins_q: m.wins.sumsq,
    })),
  );
  if (rows.length) await db()`insert into sim_move_sums ${db()(rows)} on conflict do nothing`;
  await db()`
    insert into sim_chunks ${db()(
      results.map((r) => ({
        job_id: jobId,
        chunk: r.chunk,
        result: db().json({ ...r, moves: {} } as never),
      })),
    )}
    on conflict do nothing
  `;
  await db()`
    update sim_groups set posted = posted + ${results.length}
    where job_id = ${jobId} and grp = ${group}
  `;
  const [state] = await db()<{ back: boolean }[]>`
    select bool_and(g.posted >= least(g.next_chunk, g.max_seasons / j.chunk_seasons)) as back
    from sim_groups g join sim_jobs j on j.id = g.job_id where g.job_id = ${jobId}
  `;
  if (!state?.back) {
    const [due] = await db()`
      update sim_jobs set refreshed_at = now()
      where id = ${jobId} and (refreshed_at is null
        or refreshed_at < now() - ${`${saverOn() ? SAVER_REFRESH_GAP_S : REFRESH_GAP_S} seconds`}::interval)
      returning id
    `;
    if (!due) return { done: false };
  }
  return refreshJob(jobId);
}

/** Every move's summed differences so far (summed in the database: one row per move). */
async function moveSums(jobId: number): Promise<Map<string, MoveSums>> {
  const rows = await db()<
    {
      key: string;
      n: number;
      title_s: number;
      title_q: number;
      playoffs_s: number;
      playoffs_q: number;
      seed1_s: number;
      seed1_q: number;
      bye_s: number;
      bye_q: number;
      wins_s: number;
      wins_q: number;
    }[]
  >`
    select key, sum(n)::float8 as n,
      sum(title_s) as title_s, sum(title_q) as title_q,
      sum(playoffs_s) as playoffs_s, sum(playoffs_q) as playoffs_q,
      sum(seed1_s) as seed1_s, sum(seed1_q) as seed1_q,
      sum(bye_s) as bye_s, sum(bye_q) as bye_q,
      sum(wins_s) as wins_s, sum(wins_q) as wins_q
    from sim_move_sums where job_id = ${jobId} group by key
  `;
  const m = (n: number, sum: number, sumsq: number) => ({ n, sum, sumsq });
  return new Map(
    rows.map((r) => [
      r.key,
      {
        title: m(r.n, r.title_s, r.title_q),
        playoffs: m(r.n, r.playoffs_s, r.playoffs_q),
        seed1: m(r.n, r.seed1_s, r.seed1_q),
        bye: m(r.n, r.bye_s, r.bye_q),
        wins: m(r.n, r.wins_s, r.wins_q),
      },
    ]),
  );
}

/** Each contender's mean title difference in each of its chunks (for P(best)). */
async function titleMeans(
  jobId: number,
  keys: string[],
): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>();
  if (keys.length < 2) return out;
  const rows = await db()<{ key: string; chunk: number; m: number }[]>`
    select key, chunk, title_s / n as m from sim_move_sums
    where job_id = ${jobId} and key = any(${keys})
  `;
  for (const r of rows) {
    if (!out.has(r.key)) out.set(r.key, new Map());
    out.get(r.key)!.set(r.chunk, r.m);
  }
  return out;
}

/** The base run so far: every team's odds (weighted by seasons) and Jack's own outcomes. */
async function baseRun(jobId: number) {
  const outlook = await db()<SimTeamResult[]>`
    select (t->>'teamId')::int as "teamId",
      sum(s * (t->>'expWins')::float8) / sum(s) as "expWins",
      sum(s * (t->>'expPointsFor')::float8) / sum(s) as "expPointsFor",
      sum(s * (t->>'playoffs')::float8) / sum(s) as playoffs,
      sum(s * (t->>'seed1')::float8) / sum(s) as seed1,
      sum(s * coalesce((t->>'bye')::float8, 0)) / sum(s) as bye,
      sum(s * (t->>'final')::float8) / sum(s) as final,
      sum(s * (t->>'champ')::float8) / sum(s) as champ,
      sum(s * coalesce((t->>'champBye')::float8, 0)) / sum(s) as "champBye"
    from (
      select (result->>'seasons')::float8 as s, result->'outlook' as o
      from sim_chunks where job_id = ${jobId}
    ) c, jsonb_array_elements(c.o) t
    group by 1
  `;
  const [b] = await db()<
    { seasons: number; title: number; playoffs: number; seed1: number; bye: number; wins: number }[]
  >`
    select coalesce(sum((result->>'seasons')::float8), 0) as seasons,
      coalesce(sum((result->'base'->>'title')::float8), 0) as title,
      coalesce(sum((result->'base'->>'playoffs')::float8), 0) as playoffs,
      coalesce(sum((result->'base'->>'seed1')::float8), 0) as seed1,
      coalesce(sum((result->'base'->>'bye')::float8), 0) as bye,
      coalesce(sum((result->'base'->>'wins')::float8), 0) as wins
    from sim_chunks where job_id = ${jobId}
  `;
  const seasons = b?.seasons ?? 0;
  const avg = (x: number | undefined) => (seasons ? (x ?? 0) / seasons : 0);
  return {
    outlook,
    base: {
      seasons,
      title: avg(b?.title),
      playoffs: avg(b?.playoffs),
      seed1: avg(b?.seed1),
      bye: avg(b?.bye),
      wins: avg(b?.wins),
    },
  };
}

async function refreshJob(jobId: number, closing = false): Promise<{ done: boolean }> {
  const [job] = await db()<JobRow[]>`
    select id, status, trigger, team_id, scoring_period, read_at, waiver_fingerprint, roster_key,
      replays, chunk_seasons, max_chunks, outlook_run_id, meta
    from sim_jobs where id = ${jobId}
  `;
  if (!job) return { done: true };
  const groups = await db()<GroupRow[]>`
    select grp, prio, keys, active, cardinality(active) as n_active, next_chunk, posted,
      target_2se, min_seasons, max_seasons, min_seasons / ${job.chunk_seasons} as min_chunks,
      max_seasons / ${job.chunk_seasons} as max_chunks
    from sim_groups where job_id = ${jobId} order by prio, grp
  `;
  // Each move is checked to its group's precision (ADR-060).
  const tiers = new Map<string, Tier>(
    groups.flatMap((g) =>
      g.keys.map((k) => [
        k,
        { target2se: g.target_2se, minSeasons: g.min_seasons, maxSeasons: g.max_seasons },
      ]),
    ),
  );
  const { outlook, base } = await baseRun(jobId);
  if (!base.seasons) return { done: job.status === "done" };
  const effects = effectsFromSums(
    groups.flatMap((g) => g.keys),
    await moveSums(jobId),
    (k) => tiers.get(k) ?? TOP_TIER,
  );
  // "Best" is among waiver moves (trade ideas are checked too, but compared on their own).
  const contenders = contendersOf(
    effects,
    new Set(effects.filter((e) => !e.key.startsWith("trade:")).map((e) => e.key)),
  );
  withPBest(
    effects,
    contenders,
    await titleMeans(
      jobId,
      contenders.map((e) => e.key),
    ),
  );

  // Each group keeps only its moves still getting seasons.
  const active = new Set(effects.filter((e) => e.active).map((e) => e.key));
  const next = groups.map((g) => {
    const still = g.active.filter((k) => active.has(k));
    return { ...g, active: still, n_active: still.length };
  });
  // Moves that stopped getting seasons since the last refresh are settled.
  const settled = new Set(groups.flatMap((g) => g.active.filter((k) => !active.has(k))));
  for (const [i, g] of next.entries()) {
    if (g.active.length === groups[i]!.active.length) continue;
    await db()`update sim_groups set active = ${g.active} where job_id = ${jobId} and grp = ${g.grp}`;
  }
  const noMoreToIssue = next.every((g) => !groupHasWork(g));
  const allBack = next.every((g) => g.posted >= Math.min(g.next_chunk, g.max_chunks));
  const done = job.status !== "superseded" && noMoreToIssue && (allBack || closing);

  // The Outlook: every team's odds from the base run so far.
  const meta = new Map(job.meta.map((t) => [t.teamId, t]));
  const results: OutlookTeam[] = outlook
    .map((r) => ({ ...meta.get(r.teamId)!, ...r }))
    .sort((a, b) => b.champ - a.champ);
  let runId = job.outlook_run_id;
  if (job.status !== "superseded") {
    if (runId == null) {
      const [r] = await db()<{ id: number }[]>`
        insert into outlook_runs (run_at, scoring_period, seasons, results, trigger, status, updated_at)
        values (${job.read_at}, ${job.scoring_period}, ${base.seasons}, ${db().json(results as never)},
          ${job.trigger}, ${done ? "final" : "running"}, now())
        returning id
      `;
      runId = r!.id;
    } else {
      await db()`
        update outlook_runs set seasons = ${base.seasons}, results = ${db().json(results as never)},
          status = ${done ? "final" : "running"}, updated_at = now()
        where id = ${runId}
      `;
    }
    const value: DeepChecks = {
      jobId,
      rosterKey: job.roster_key ?? "",
      waiverFingerprint: job.waiver_fingerprint ?? "",
      seasons: base.seasons,
      base,
      effects,
      final: done,
      at: new Date().toISOString(),
    };
    await writeView(DEEP_KEY, job.waiver_fingerprint ?? "", value, 0);
    // Each move's settled numbers, kept while later checks run (every move once the job's done,
    // for the final P(best)).
    await storeSettled(
      jobId,
      job.roster_key ?? "",
      effects.filter((e) => e.seasons > 0 && (done || settled.has(e.key))),
    );
  }
  await db()`
    update sim_jobs set outlook_run_id = ${runId}, refreshed_at = now(),
      status = ${done ? "done" : job.status === "queued" ? "running" : job.status},
      updated_at = now()
    where id = ${jobId}
  `;
  return { done };
}

/**
 * Close jobs whose runners went quiet with what they have (5-minute job). Returns how many
 * live jobs have had no runner at all for 15 minutes (the worker isn't starting).
 */
export async function closeQuietJobs(): Promise<{ closed: number; unstarted: number }> {
  if (!dbConfigured()) return { closed: 0, unstarted: 0 };
  const quiet = await db()<{ id: number }[]>`
    select id from sim_jobs where status = 'running'
      and coalesce(last_worker_at, created_at) < now() - ${`${STALE_MS / 1000} seconds`}::interval
  `;
  for (const j of quiet) await refreshJob(j.id, true);
  const [u] = await db()<{ n: number }[]>`
    select count(*)::int as n from sim_jobs
    where status = 'queued' and created_at < now() - interval '15 minutes'
  `;
  return { closed: quiet.length, unstarted: u?.n ?? 0 };
}

/** Add a worker request's Vercel CPU to its job (what the worker costs Vercel per job). */
export async function addJobCpu(jobId: number, since: NodeJS.CpuUsage): Promise<void> {
  const u = process.cpuUsage(since);
  const ms = Math.round((u.user + u.system) / 1000);
  await db()`update sim_jobs set vercel_cpu_ms = vercel_cpu_ms + ${ms} where id = ${jobId}`.catch(
    () => {},
  );
}

/** Delete jobs older than two days and their chunks (nightly), keeping the last finished one. */
export async function pruneSimJobs(): Promise<number> {
  if (!dbConfigured()) return 0;
  const rows = await db()`
    delete from sim_jobs where created_at < now() - interval '2 days'
      and id <> coalesce((select max(id) from sim_jobs where status = 'done'), 0)
    returning id
  `;
  // CPU measurements are kept for 30 days (Vercel's window).
  await db()`delete from cpu_log where ran_at < now() - interval '30 days'`;
  return rows.length;
}

/** Store moves' settled results (a newer job's result is never replaced by an older one's). */
async function storeSettled(jobId: number, rosterKey: string, effects: DeepEffect[]) {
  if (!effects.length) return;
  await db()`
    insert into move_results ${db()(
      effects.map((e) => ({
        key: e.key,
        job_id: jobId,
        roster_key: rosterKey,
        effect: db().json(e as never),
      })),
    )}
    on conflict (key) do update set job_id = excluded.job_id, roster_key = excluded.roster_key,
      effect = excluded.effect, settled_at = now()
    where move_results.job_id <= excluded.job_id
  `;
}

/** The latest worker job, with its results when the stored deep checks are this job's. */
export async function liveJob(): Promise<
  (LiveJob & { trigger: string | null; createdAt: Date; settled: number; total: number }) | null
> {
  if (!dbConfigured()) return null;
  const [[j], deep] = await Promise.all([
    db()<
      {
        id: number;
        status: string;
        trigger: string | null;
        roster_key: string | null;
        created_at: Date;
      }[]
    >`
      select id, status, trigger, roster_key, created_at from sim_jobs
      where status <> 'superseded' order by id desc limit 1
    `,
    latestDeepChecks(),
  ]);
  if (!j) return null;
  const mine = deep?.jobId === j.id ? deep : null;
  const effects = mine ? new Map(mine.effects.map((e) => [e.key, e])) : null;
  const keys = await db()<{ n: number }[]>`
    select coalesce(sum(cardinality(keys)), 0)::int as n from sim_groups where job_id = ${j.id}
  `;
  return {
    id: j.id,
    rosterKey: j.roster_key ?? "",
    live: j.status === "queued" || j.status === "running",
    final: j.status === "done",
    effects,
    trigger: j.trigger,
    createdAt: j.created_at,
    settled: mine ? mine.effects.filter((e) => !e.active).length : 0,
    total: keys[0]?.n ?? 0,
  };
}

/**
 * Each add's best checked move (by title change) for the Free agents tab: from the settled
 * results and the job under way, chosen as on Moves (lib/nba/move-shown.ts).
 */
export async function bestChecksByAdd(
  addIds: number[],
  rosterNow: string,
): Promise<{
  byAdd: Map<number, { key: string; state: ShownState; effect: DeepEffect }>;
  live: boolean;
}> {
  const byAdd = new Map<number, { key: string; state: ShownState; effect: DeepEffect }>();
  if (!dbConfigured() || !addIds.length) return { byAdd, live: false };
  const ids = new Set(addIds.map(String));
  const [job, rows] = await Promise.all([
    liveJob(),
    db()<{ key: string; roster_key: string; effect: DeepEffect }[]>`
      select key, roster_key, effect from move_results
      where split_part(key, ':', 1) = any(${[...ids]})
    `,
  ]);
  const last = new Map(rows.map((r) => [r.key, { rosterKey: r.roster_key, effect: r.effect }]));
  const keys = new Set([
    ...last.keys(),
    ...[...(job?.effects?.keys() ?? [])].filter((k) => ids.has(k.split(":")[0]!)),
  ]);
  for (const key of keys) {
    const s = chooseShown(key, job, last.get(key) ?? null, rosterNow);
    if (!s.effect || s.effect.seasons <= 0) continue;
    const add = Number(key.split(":")[0]);
    const cur = byAdd.get(add);
    if (!cur || s.effect.title.d > cur.effect.title.d)
      byAdd.set(add, { key, state: s.state, effect: s.effect });
  }
  return { byAdd, live: job?.live ?? false };
}

/** Deep checks for these move keys as a page shows them (lib/nba/move-shown.ts). */
export async function deepChecksFor(keys: string[], rosterNow: string): Promise<DeepView> {
  const [job, last] = await Promise.all([liveJob(), settledResults(keys)]);
  return deepView(keys, job, last, rosterNow);
}

/** Moves' last settled results, by key. */
export async function settledResults(keys: string[]): Promise<Map<string, SettledResult>> {
  if (!dbConfigured() || !keys.length) return new Map();
  const rows = await db()<{ key: string; roster_key: string; effect: DeepEffect }[]>`
    select key, roster_key, effect from move_results where key = any(${keys})
  `;
  return new Map(rows.map((r) => [r.key, { rosterKey: r.roster_key, effect: r.effect }]));
}

/** The latest deep checks (for the Moves page). */
export async function latestDeepChecks(): Promise<DeepChecks | null> {
  if (!dbConfigured()) return null;
  const [r] = await db()<
    { value: DeepChecks }[]
  >`select value from view_cache where key = ${DEEP_KEY}`;
  return r?.value ?? null;
}

/**
 * Jack asked for a deep check of one move (a drop he picked): the job under way has it, or a
 * new job puts it first.
 */
export async function requestMoveCheck(key: string): Promise<number | null> {
  if (!dbConfigured()) return null;
  const [live] = await db()<{ id: number; has: boolean }[]>`
    select id,
      exists (select 1 from sim_groups g where g.job_id = j.id and ${key} = any(g.keys)) as has
    from sim_jobs j where status in ('queued', 'running')
    order by id desc limit 1
  `;
  // Already in the live job: make sure a runner is on it (e.g. after one failed to start).
  if (live?.has) {
    await startWorker();
    return live.id;
  }
  return enqueueSimJob("You asked for a deep check of a move", [key]);
}

/**
 * Jack asked to simulate these trades (the first of each ask to the top tier): the job under
 * way already has them all, or a new job checks them (and the asks stay until they're settled).
 */
export async function requestTradeChecks(
  trades: { spec: TradeSpec; top: boolean }[],
  label: string,
): Promise<number | null> {
  if (!dbConfigured() || !trades.length) return null;
  const keys = await addAskedTrades(trades);
  const [live] = await db()<{ id: number; has: number }[]>`
    select id, (
      select count(distinct k)::int from sim_groups g, unnest(g.keys) k
      where g.job_id = j.id and k = any(${keys})
    ) as has
    from sim_jobs j where status in ('queued', 'running')
    order by id desc limit 1
  `;
  if (live && live.has === keys.length) {
    await startWorker();
    return live.id;
  }
  return enqueueSimJob(label);
}
