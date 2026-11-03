import "server-only";
// Season simulations on the GitHub Actions worker (ADR-053). Vercel builds a job, the season as
// it stands (the base run, i.e. the Outlook) plus Jack's candidate waiver moves, as plain JSON;
// runners take chunks of 200 seasons each, post back paired results, and every post updates
// the Outlook and the Moves checks. Moves stop getting seasons once their title change is known
// to ±0.5 points (or 20,000 seasons); clearly worse moves stop early.

import {
  toWire,
  type ChunkResult,
  type SimPlayer,
  type WireInput,
  type WireMove,
} from "@fantasy-copilot/fantasy-core";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { db, dbConfigured } from "@/lib/db";
import { fingerprintOf, writeView } from "@/lib/view-cache";
import { absences } from "./availability";
import {
  MAX_SEASONS,
  MIN_BASE_SEASONS,
  baseOdds,
  combine,
  combineOutlook,
  type DeepEffect,
} from "./deep-check";
import { dispatchWorker } from "./github-dispatch";
import { moveKey, rosterKey, waiverFingerprint } from "./move-checks";
import { buildOutlookInput } from "./outlook";
import { outlookSetup, type OutlookTeam } from "./outlook-run";
import { loadWaiverView } from "./waivers-view";

export const CHUNK_SEASONS = 200;
export const REPLAYS = 10;
/** Moves checked deeply: the best by the points estimate, plus any Jack asked for. */
const DEEP_MOVES = 15;
const MAX_CHUNKS = MAX_SEASONS / CHUNK_SEASONS;
const MIN_BASE_CHUNKS = MIN_BASE_SEASONS / CHUNK_SEASONS;
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
  setup: WireInput;
  moves: WireMove[];
  waiver_fingerprint: string | null;
  roster_key: string | null;
  replays: number;
  chunk_seasons: number;
  next_chunk: number;
  max_chunks: number;
  active: string[];
  outlook_run_id: number | null;
  meta: OutlookTeam[];
  updated_at: Date;
}

/**
 * Queue the season as it stands now for the worker, and start it. `extraKeys`: moves Jack asked
 * to check (a drop he picked). Returns the job id (an identical queued or finished job is reused).
 */
export async function enqueueSimJob(
  trigger: string | null,
  extraKeys: string[] = [],
): Promise<number | null> {
  if (!dbConfigured()) return null;
  const { setup, v, base, wire, moves } = await buildJob(extraKeys);
  const { data } = setup;
  const myId = data.me.id;
  return storeJob({ trigger, setup, v, base, wire, moves, myId });
}

/** The season as it stands, as plain JSON, and the candidate moves (`only`: just extraKeys). */
async function buildJob(extraKeys: string[], only = false) {
  const [setup, v] = await Promise.all([outlookSetup(), loadWaiverView()]);
  const { data } = setup;
  const myId = data.me.id;

  const inputFor = (roster: RosterPlayer[], freeAgents: RosterPlayer[], extra: RosterPlayer[]) => {
    const injured = new Map(setup.injured);
    for (const [id, a] of absences(extra, data.injuries, setup.fromDay)) injured.set(id, a);
    return buildOutlookInput({
      teams: data.teams.map((t) => (t.id === myId ? { ...t, roster } : t)),
      previousTeams: setup.previousTeams,
      freeAgents,
      games: data.games,
      matchups: data.matchups,
      slotCounts: data.settings.slotCounts,
      addCapPerWeek: data.settings.addsPerWeek ?? 3,
      regularWeeks: data.settings.regularSeasonWeeks,
      fromDay: setup.fromDay,
      bankedNow: setup.bankedNow,
      injured,
      seasons: 0,
    });
  };
  const base = inputFor(data.me.roster, setup.freeAgents, []);
  const wire = toWire(base.input);

  // Candidate moves: the best by the points estimate (any add, any drop), and requested ones.
  const options = [...v.analysis.dropOptions.values()].flat();
  const ranked = [...options].sort((x, y) => y.netWins - x.netWins);
  const picked = new Map<string, (typeof options)[number]>();
  for (const o of only ? [] : ranked) {
    if (picked.size >= DEEP_MOVES) break;
    picked.set(moveKey(o), o);
  }
  for (const k of extraKeys) {
    const o = options.find((x) => moveKey(x) === k);
    if (o) picked.set(k, o);
  }
  const moves: WireMove[] = [...picked.entries()].map(([key, o]) => {
    const roster = [
      ...data.me.roster
        .filter((p) => p.id !== o.drop?.id)
        .map((p) => (p.id === o.il?.id ? { ...p, slot: "IR" } : p)),
      { ...o.add.player, slot: "BE" },
    ];
    const pool = [
      ...setup.freeAgents.filter((p) => p.id !== o.add.player.id),
      ...(o.drop ? [o.drop] : []),
    ];
    const w = toWire(inputFor(roster, pool, [o.add.player]).input);
    const mine = w.teams.find((t) => t.id === myId)!;
    return { key, roster: mine.roster as SimPlayer[], irCut: mine.irCut, freeAgents: w.freeAgents };
  });
  return { setup, v, base, wire, moves };
}

async function storeJob({
  trigger,
  setup,
  v,
  base,
  wire,
  moves,
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
      active: moves.map((m) => m.key),
      meta: db().json(meta as never),
    })}
    returning id
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
    select 1 from sim_jobs where status in ('queued', 'running')
      and next_chunk < max_chunks
      and (cardinality(active) > 0 or next_chunk < ${MIN_BASE_CHUNKS})
    limit 1
  `;
  return rows.length > 0;
}

export interface Assignment {
  jobId: number;
  teamId: number;
  replays: number;
  chunkSeasons: number;
  chunks: number[];
  active: string[];
  /** Only when the runner doesn't have this job yet. */
  setup?: WireInput;
  moves?: WireMove[];
}

/** Hand a runner its next chunks of the newest live job (none when nothing's left to run). */
export async function nextAssignment(
  count: number,
  have: number | null,
): Promise<Assignment | null> {
  const [job] = await db()<JobRow[]>`
    select * from sim_jobs where status in ('queued', 'running')
    order by id desc limit 1
  `;
  if (!job) return null;
  if (!job.active.length && job.next_chunk >= MIN_BASE_CHUNKS) return null;
  // Atomic and never capped, so concurrent runners get disjoint chunks; past the cap is ignored.
  const [taken] = await db()<{ next_chunk: number }[]>`
    update sim_jobs set next_chunk = next_chunk + ${count},
      status = 'running', last_worker_at = now(), updated_at = now()
    where id = ${job.id} and next_chunk < max_chunks
    returning next_chunk
  `;
  if (!taken) return null;
  const chunks = Array.from({ length: count }, (_, i) => taken.next_chunk - count + i).filter(
    (c) => c < job.max_chunks,
  );
  return {
    jobId: job.id,
    teamId: job.team_id,
    replays: job.replays,
    chunkSeasons: job.chunk_seasons,
    chunks,
    active: job.active,
    ...(have === job.id ? {} : { setup: job.setup, moves: job.moves }),
  };
}

/** Store a runner's chunk and update the Outlook and the Moves checks with everything so far. */
export async function postChunk(jobId: number, result: ChunkResult): Promise<{ done: boolean }> {
  await db()`
    insert into sim_chunks (job_id, chunk, result) values (${jobId}, ${result.chunk}, ${db().json(result as never)})
    on conflict do nothing
  `;
  return refreshJob(jobId);
}

async function refreshJob(jobId: number, closing = false): Promise<{ done: boolean }> {
  const [job] = await db()<JobRow[]>`select * from sim_jobs where id = ${jobId}`;
  if (!job) return { done: true };
  const chunks = (
    await db()<{ result: ChunkResult }[]>`select result from sim_chunks where job_id = ${jobId}`
  ).map((r) => r.result);
  if (!chunks.length) return { done: job.status === "done" };
  const keys = job.moves.map((m) => m.key);
  const effects = combine(chunks, keys);
  const active = effects.filter((e) => e.active).map((e) => e.key);
  const posted = chunks.length;
  const issued = Math.min(job.next_chunk, job.max_chunks);
  const noMoreToIssue =
    job.next_chunk >= job.max_chunks || (!active.length && job.next_chunk >= MIN_BASE_CHUNKS);
  const done = job.status !== "superseded" && noMoreToIssue && (posted >= issued || closing);
  const base = baseOdds(chunks);

  // The Outlook: every team's odds from the base run so far.
  const outlook = combineOutlook(chunks);
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
    update sim_jobs set active = ${active}, outlook_run_id = ${runId},
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
  const [live] = await db()<{ id: number; roster_key: string | null; moves: WireMove[] }[]>`
    select id, roster_key, moves from sim_jobs where status in ('queued', 'running')
    order by id desc limit 1
  `;
  // Already in the live job: make sure a runner is on it (e.g. after one failed to start).
  if (live?.moves.some((m) => m.key === key)) {
    await startWorker();
    return live.id;
  }
  const v = await loadWaiverView();
  if (live && live.roster_key === rosterKey(v)) {
    const move = await buildMove(key);
    if (move) {
      await db()`
        update sim_jobs set moves = moves || ${db().json([move] as never)}::jsonb,
          active = array_append(active, ${key}), updated_at = now()
        where id = ${live.id}
      `;
      await startWorker();
      return live.id;
    }
  }
  return enqueueSimJob("You asked for a deep check of a move", [key]);
}
