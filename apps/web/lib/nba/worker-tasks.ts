import "server-only";
// Tasks for the GitHub Actions worker besides simulations (docs/COMPUTE.md). Vercel queues a
// task with its input; a runner claims it, computes, and posts the result, which is stored
// where the pages read it. One live task per kind and input; a newer input supersedes a
// queued one of the same kind.

import { db, dbConfigured } from "@/lib/db";
import { writeView } from "@/lib/view-cache";
import { dispatchWorker } from "./github-dispatch";
import type { StoredIdea } from "./trade-task";

export type TaskKind = "trade-search";

/** Where each kind's result goes. */
const RESULT_VIEW: Record<TaskKind, string> = { "trade-search": "trade-targets" };

/** A claimed task runs at most this long before it's handed out again. */
const LEASE = "5 minutes";
const MAX_ATTEMPTS = 3;
/** Runners waiting for tasks heartbeat this lock (so a new task doesn't start another run). */
export const POLL_LOCK = "worker-tasks";

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

/** Any task waiting (for the worker's first question). */
export async function hasTasks(): Promise<boolean> {
  const rows = await db()`select 1 from worker_tasks where status = 'queued' limit 1`;
  return rows.length > 0;
}

/** The oldest task to run (or one whose runner went quiet), claimed; null when none. */
export async function claimTask(): Promise<{ id: number; kind: TaskKind; input: unknown } | null> {
  await db()`
    insert into job_locks (name, until) values (${POLL_LOCK}, now() + interval '90 seconds')
    on conflict (name) do update set until = excluded.until
  `;
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

/** Store a task's result where its pages read it, and close it. */
export async function finishTask(id: number, result: unknown, error?: string): Promise<boolean> {
  const [t] = await db()<{ kind: TaskKind; fingerprint: string }[]>`
    update worker_tasks set status = ${error ? "failed" : "done"}, finished_at = now(),
      error = ${error ?? null}
    where id = ${id} and status = 'running'
    returning kind, fingerprint
  `;
  if (!t) return false;
  if (!error) await writeView(RESULT_VIEW[t.kind], t.fingerprint, result as StoredIdea[], 0);
  return true;
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
