import "server-only";
// Season simulations on the GitHub Actions worker (ADR-053). Vercel builds a job, the season as
// it stands (the base run, i.e. the Outlook) plus every candidate waiver move (ADR-058), as
// plain JSON. The moves are split into groups of 12, most important first; runners take a
// group's chunks of 200 seasons, post back paired results, and the Outlook and the Moves checks
// update from the sums. Moves stop getting seasons once their title change is known to ±0.5
// points (or 20,000 seasons); clearly worse moves stop early.

import {
  toWire,
  type ChunkResult,
  type SimTeamResult,
  type WireInput,
  type WireMove,
} from "@fantasy-copilot/fantasy-core";
import { db, dbConfigured } from "@/lib/db";
import { fingerprintOf, writeView } from "@/lib/view-cache";
import { absences } from "./availability";
import {
  MAX_SEASONS,
  MIN_BASE_SEASONS,
  MIN_SEASONS,
  contendersOf,
  effectsFromSums,
  withPBest,
  type DeepEffect,
  type MoveSums,
} from "./deep-check";
import { CpuMeter } from "@/lib/cpu";
import { dispatchWorker } from "./github-dispatch";
import { rosterKey, waiverFingerprint } from "./move-checks";
import { buildOutlookInput } from "./outlook";
import { outlookSetup, type OutlookTeam } from "./outlook-run";
import {
  buildWireMoves,
  groupsOf,
  hasChunksLeft,
  jobMoveOptions,
  moveKey,
  pickGroup,
  type SimGroup,
} from "./sim-moves";
import { loadWaiverView } from "./waivers-view";

export const CHUNK_SEASONS = 200;
export const REPLAYS = 10;
const MAX_CHUNKS = MAX_SEASONS / CHUNK_SEASONS;
const MIN_BASE_CHUNKS = MIN_BASE_SEASONS / CHUNK_SEASONS;
/** Runners' posts recompute the checks at most this often (and whenever all are back). */
const REFRESH_GAP_S = 4;
/** A job whose runners stopped posting is closed with what it has after this long. */
const STALE_MS = 4 * 60_000;
export const DEEP_KEY = "move-checks-deep";

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

type GroupRow = SimGroup & { keys: string[] };

const groupHasWork = (g: SimGroup, maxChunks: number) =>
  hasChunksLeft(g, maxChunks, MIN_BASE_CHUNKS);

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
  const built = await buildJob(extraKeys, false, m);
  return m.step("store", () => storeJob({ ...built, trigger, myId: built.setup.data.me.id }));
}

/**
 * The season as it stands, as plain JSON, and the moves to check in order (`only`: just
 * extraKeys). `leading`: how many of them are the Moves page's opening moves.
 */
async function buildJob(extraKeys: string[], only = false, m = new CpuMeter()) {
  // Read and parsed together (both read the league): one step.
  const [setup, v] = await m.step("inputs", () => Promise.all([outlookSetup(), loadWaiverView()]));
  const { data } = setup;
  const myId = data.me.id;
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
  const wire = toWire(base.input);

  const all = [...v.analysis.dropOptions.values()].flat();
  const { options, leading } = only
    ? {
        options: extraKeys.flatMap((k) => all.filter((o) => moveKey(o) === k)),
        leading: extraKeys.length,
      }
    : jobMoveOptions(v.analysis, extraKeys);
  // The adds' own absences (they're not on a roster, so not in the setup's).
  const injured = new Map(setup.injured);
  const adds = options.map((o) => o.add.player);
  for (const [id, a] of absences(adds, data.injuries, setup.fromDay)) injured.set(id, a);
  const moves = await m.step("build-moves", () =>
    buildWireMoves(
      {
        base: wire,
        teamId: myId,
        roster: data.me.roster,
        freeAgents: setup.freeAgents,
        games: data.games,
        slotCounts: data.settings.slotCounts,
        fromDay: setup.fromDay,
        regularWeeks: data.settings.regularSeasonWeeks,
        injured,
      },
      options,
    ),
  );
  return { setup, v, base, wire, moves, leading };
}

async function storeJob({
  trigger,
  setup,
  v,
  base,
  wire,
  moves,
  leading,
  myId,
}: Awaited<ReturnType<typeof buildJob>> & { trigger: string | null; myId: number }) {
  const { data } = setup;

  const fingerprint = fingerprintOf({ wire, moves: moves.map((m) => m.key) });
  const [same] = await db()<{ id: number }[]>`
    select id from sim_jobs where fingerprint = ${fingerprint}
      and status in ('queued', 'running', 'done') order by id desc limit 1
  `;
  if (same) {
    await startWorker();
    return same.id;
  }
  const meta: OutlookTeam[] = data.teams.map((t) => {
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
  });
  await db()`update sim_jobs set status = 'superseded', updated_at = now()
    where status in ('queued', 'running')`;
  const [row] = await db()<{ id: number }[]>`
    insert into sim_jobs ${db()({
      trigger,
      team_id: myId,
      scoring_period: setup.fromDay,
      read_at: setup.readAt,
      fingerprint,
      setup: db().json(wire as never),
      moves: db().json(moves as never),
      waiver_fingerprint: waiverFingerprint(v),
      roster_key: rosterKey(v),
      replays: REPLAYS,
      chunk_seasons: CHUNK_SEASONS,
      max_chunks: MAX_CHUNKS,
      active: [],
      meta: db().json(meta as never),
    })}
    returning id
  `;
  // The opening moves (and any Jack asked for) get the first groups and their seasons first.
  const groups = groupsOf(moves.map((m) => m.key));
  await db()`
    insert into sim_groups ${db()(
      groups.map((keys, grp) => ({
        job_id: row!.id,
        grp,
        prio: grp * 12 < leading ? 1 : 2,
        keys,
        active: keys,
      })),
    )}
  `;
  await startWorker();
  return row!.id;
}

/** Start the worker unless runners are already working (they pick up the newest job). */
async function startWorker() {
  const [busy] = await db()`
    select 1 from sim_jobs where last_worker_at > now() - interval '45 seconds' limit 1
  `;
  if (!busy) await dispatchWorker().catch(() => false);
}

/** One move as the worker plays it, built from the season as it stands now. */
async function buildMove(key: string): Promise<WireMove | null> {
  const built = await buildJob([key], true);
  return built.moves.find((m) => m.key === key) ?? null;
}

/** Is there work for a runner? (Cheap: one query.) */
export async function hasWork(): Promise<boolean> {
  const rows = await db()`
    select 1 from sim_jobs j join sim_groups g on g.job_id = j.id
    where j.status in ('queued', 'running') and g.next_chunk < j.max_chunks
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
  const [job] = await db()<
    {
      id: number;
      team_id: number;
      replays: number;
      chunk_seasons: number;
      max_chunks: number;
      n_moves: number;
    }[]
  >`
    select id, team_id, replays, chunk_seasons, max_chunks, jsonb_array_length(moves) as n_moves
    from sim_jobs where status in ('queued', 'running')
    order by id desc limit 1
  `;
  if (!job) return null;
  const groups = await db()<GroupRow[]>`
    select grp, prio, keys, active, next_chunk, posted from sim_groups
    where job_id = ${job.id} order by prio, grp
  `;
  const g = pickGroup(groups, job.max_chunks, MIN_BASE_CHUNKS, MIN_SEASONS / CHUNK_SEASONS);
  if (!g) return null;
  // Atomic and never capped, so concurrent runners get disjoint chunks; past the cap is ignored.
  const [taken] = await db()<{ next_chunk: number }[]>`
    update sim_groups set next_chunk = next_chunk + ${count}
    where job_id = ${job.id} and grp = ${g.grp} and next_chunk < ${job.max_chunks}
    returning next_chunk
  `;
  if (!taken) return null;
  await db()`
    update sim_jobs set status = 'running', last_worker_at = now(), updated_at = now()
    where id = ${job.id}
  `;
  const chunks = Array.from({ length: count }, (_, i) => taken.next_chunk - count + i).filter(
    (c) => c < job.max_chunks,
  );
  const fresh = have !== job.id || (haveMoves != null && haveMoves !== job.n_moves);
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
    active: g.active,
    ...(input ? { setup: input.setup, moves: input.moves } : {}),
  };
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
    select bool_and(g.posted >= least(g.next_chunk, j.max_chunks)) as back
    from sim_groups g join sim_jobs j on j.id = g.job_id where g.job_id = ${jobId}
  `;
  if (!state?.back) {
    const [due] = await db()`
      update sim_jobs set refreshed_at = now()
      where id = ${jobId} and (refreshed_at is null
        or refreshed_at < now() - ${`${REFRESH_GAP_S} seconds`}::interval)
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
    select grp, prio, keys, active, next_chunk, posted from sim_groups
    where job_id = ${jobId} order by prio, grp
  `;
  const { outlook, base } = await baseRun(jobId);
  if (!base.seasons) return { done: job.status === "done" };
  const effects = effectsFromSums(
    groups.flatMap((g) => g.keys),
    await moveSums(jobId),
  );
  const contenders = contendersOf(effects);
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
  const next = groups.map((g) => ({ ...g, active: g.active.filter((k) => active.has(k)) }));
  for (const [i, g] of next.entries()) {
    if (g.active.length === groups[i]!.active.length) continue;
    await db()`update sim_groups set active = ${g.active} where job_id = ${jobId} and grp = ${g.grp}`;
  }
  const noMoreToIssue = next.every((g) => !groupHasWork(g, job.max_chunks));
  const allBack = next.every((g) => g.posted >= Math.min(g.next_chunk, job.max_chunks));
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

/** The latest deep checks (for the Moves page). */
export async function latestDeepChecks(): Promise<DeepChecks | null> {
  if (!dbConfigured()) return null;
  const [r] = await db()<
    { value: DeepChecks }[]
  >`select value from view_cache where key = ${DEEP_KEY}`;
  return r?.value ?? null;
}

/**
 * Jack asked for a deep check of one move (a drop he picked): add it to the job under way when
 * that job has his current roster, otherwise queue a new job that includes it.
 */
export async function requestMoveCheck(key: string): Promise<number | null> {
  if (!dbConfigured()) return null;
  const [live] = await db()<{ id: number; roster_key: string | null; has: boolean }[]>`
    select id, roster_key,
      exists (select 1 from sim_groups g where g.job_id = j.id and ${key} = any(g.keys)) as has
    from sim_jobs j where status in ('queued', 'running')
    order by id desc limit 1
  `;
  // Already in the live job: make sure a runner is on it (e.g. after one failed to start).
  if (live?.has) {
    await startWorker();
    return live.id;
  }
  const v = await loadWaiverView();
  if (live && live.roster_key === rosterKey(v)) {
    const move = await buildMove(key);
    if (move) {
      // Its own group, ahead of the rest (runners holding the job fetch its moves again).
      await db()`
        update sim_jobs set moves = moves || ${db().json([move] as never)}::jsonb, updated_at = now()
        where id = ${live.id}
      `;
      await db()`
        insert into sim_groups (job_id, grp, prio, keys, active)
        select ${live.id}, coalesce(max(grp), -1) + 1, 0, ${[key]}, ${[key]}
        from sim_groups where job_id = ${live.id}
      `;
      await startWorker();
      return live.id;
    }
  }
  return enqueueSimJob("You asked for a deep check of a move", [key]);
}
