import "server-only";
// Tasks for the GitHub Actions worker besides simulations (docs/COMPUTE.md). Vercel queues a
// task with its input; a runner claims it, computes, and posts the result, which is stored
// where the pages read it. One live task per kind and input; a newer input supersedes a
// queued one of the same kind.

import { db, dbConfigured } from "@/lib/db";
import { dispatchWorker } from "./github-dispatch";

/** trade-search: the trade idea search; sim-build: a simulation job's moves (ADR-059). */
export type TaskKind = "trade-search" | "sim-build";

/** A claimed task runs at most this long before it's handed out again. */
const LEASE = "5 minutes";
const MAX_ATTEMPTS = 3;
/** The task runner heartbeats this lock while it's up (so a new task doesn't start a run). */
export const POLL_LOCK = "worker-tasks";
/**
 * Simulation runners heartbeat this one while they wait for work (a job being built), so a
 * job stored then doesn't start another run. The task runner's lock doesn't count for jobs:
 * it can outlive the simulation runners.
 */
export const SIM_LOCK = "worker-sims";

/** Heartbeat a runner lock for the next `seconds` (runners refresh it each time they poll). */
export async function heartbeat(name: string, seconds = 90) {
  await db()`
    insert into job_locks (name, until) values (${name}, now() + ${`${seconds} seconds`}::interval)
    on conflict (name) do update set until = excluded.until
  `;
}

/** Queue a task (true when queued, false when the same input is already queued or running). */
export async function enqueueTask(kind: TaskKind, fingerprint: string, input: unknown) {
  if (!dbConfigured()) return false;
  await db()`
    update worker_tasks set status = 'superseded', finished_at = now()
    where kind = ${kind} and status = 'queued' and fingerprint <> ${fingerprint}
  `;
  const rows = await db()`
    insert into worker_tasks (kind, fingerprint, input)
    values (${kind}, ${fingerprint}, ${db().json(input as never)})
    on conflict (kind, fingerprint) where status in ('queued', 'running') do nothing
    returning id
  `;
  if (rows.length) await startWorkerForTasks();
  return rows.length > 0;
}

/** Start a workflow run unless a runner is already waiting for tasks or simulating. */
async function startWorkerForTasks() {
  const [busy] = await db()`
    select 1 from job_locks where name = ${POLL_LOCK} and until > now()
    union all
    select 1 from sim_jobs where last_worker_at > now() - interval '45 seconds'
    limit 1
  `;
  if (!busy) await dispatchWorker().catch(() => false);
}

/** Is a task of this kind queued or running? */
export async function taskPending(kind: TaskKind): Promise<boolean> {
  if (!dbConfigured()) return false;
  const rows = await db()`
    select 1 from worker_tasks where kind = ${kind} and status in ('queued', 'running') limit 1
  `;
  return rows.length > 0;
}

/**
 * Any task waiting or being run (for the worker's first question; simulation runners also wait
 * for a sim-build being run, whose job is theirs).
 */
export async function hasTasks(): Promise<boolean> {
  const rows = await db()`
    select 1 from worker_tasks where status = 'queued'
      or (status = 'running' and started_at > now() - ${LEASE}::interval)
    limit 1
  `;
  return rows.length > 0;
}

/**
 * Should the task runner stay up? Tasks waiting or being run, or simulation runners working
 * right now (a roster move often brings a task later). A job merely queued doesn't count: its
 * runners come with the next run, which can't start while this one is up.
 */
export async function taskRunnerNeeded(): Promise<boolean> {
  const rows = await db()`
    select 1 from worker_tasks where status = 'queued'
      or (status = 'running' and started_at > now() - ${LEASE}::interval)
    union all
    select 1 from sim_jobs where last_worker_at > now() - interval '45 seconds'
    limit 1
  `;
  return rows.length > 0;
}

/** The oldest task to run (or one whose runner went quiet), claimed; null when none. */
export async function claimTask(): Promise<{ id: number; kind: TaskKind; input: unknown } | null> {
  // Short (the runner polls every 10 s): a lock outliving the runner would keep a new task
  // from starting a run.
  await heartbeat(POLL_LOCK, 25);
  const [t] = await db()<{ id: number; kind: TaskKind; input: unknown }[]>`
    update worker_tasks set status = 'running', started_at = now(), attempts = attempts + 1
    where id = (
      select id from worker_tasks
      where status = 'queued'
        or (status = 'running' and started_at < now() - ${LEASE}::interval
            and attempts < ${MAX_ATTEMPTS})
      order by created_at limit 1
      for update skip locked
    )
    returning id, kind, input
  `;
  return t ?? null;
}

/**
 * Close a task; its kind and fingerprint (null when it wasn't running, e.g. handed out again
 * since). Its input is cleared (it can be megabytes; Neon's free plan has 0.5 GB), except the
 * small part a sim-build's result still needs (`keep`, read by the caller first).
 */
export async function finishTask(
  id: number,
  error?: string,
): Promise<{ kind: TaskKind; fingerprint: string } | null> {
  const [t] = await db()<{ kind: TaskKind; fingerprint: string }[]>`
    update worker_tasks set status = ${error ? "failed" : "done"}, finished_at = now(),
      error = ${error ?? null},
      input = case when kind = 'sim-build'
        then jsonb_build_object('ctx', input->'ctx', 'base', input->'build'->'base')
        else '{}'::jsonb end
    where id = ${id} and status = 'running'
    returning kind, fingerprint
  `;
  return t ?? null;
}

/** Delete finished tasks older than two days (nightly). */
export async function pruneTasks(): Promise<number> {
  const rows = await db()`
    delete from worker_tasks where created_at < now() - interval '2 days'
      and status not in ('queued', 'running')
    returning id
  `;
  return rows.length;
}
