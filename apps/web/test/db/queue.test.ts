// The worker queue against a real Postgres (test/db/test-db.ts): simulation chunks
// (lib/nba/sim-jobs.ts) and worker tasks (lib/nba/worker-tasks.ts). Every row here is synthetic.
// All database tests live in this one file: vitest runs files in parallel, and they share one
// database.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test-db";

const url = testDatabaseUrl();
if (url) process.env.DATABASE_URL = url;
// No workflow is ever dispatched from a test.
delete process.env.GITHUB_DISPATCH_TOKEN;

const { db } = await import("@/lib/db");
const { DEEP_KEY, liveJob, nextAssignment, pruneSimJobs } = await import("@/lib/nba/sim-jobs");
const { writeView } = await import("@/lib/view-cache");
const { claimTask, enqueueTask, finishTask, pruneTasks } = await import("@/lib/nba/worker-tasks");
const { pack } = await import("@/lib/gz");

const KEYS = ["1:2", "3:4"];

/** A synthetic job with one group of two moves. */
async function insertJob(over: Record<string, unknown> = {}): Promise<number> {
  const [job] = await db()<{ id: string }[]>`
    insert into sim_jobs ${db()({
      team_id: 13,
      scoring_period: 30,
      read_at: new Date(),
      fingerprint: "synthetic",
      setup: db().json({} as never),
      moves: db().json([] as never),
      setup_gz: pack({ synthetic: true }),
      moves_gz: pack(KEYS.map((key) => ({ key }))),
      replays: 10,
      chunk_seasons: 500,
      max_chunks: 320,
      active: [],
      meta: db().json([] as never),
      ...over,
    })}
    returning id
  `;
  const id = Number(job!.id);
  await db()`insert into sim_groups ${db()({
    job_id: id,
    grp: 0,
    prio: 1,
    keys: KEYS,
    active: KEYS,
    target_2se: 0.002,
    min_seasons: 4000,
    max_seasons: 40000,
  })}`;
  return id;
}

describe.skipIf(!url)("the worker queue (Postgres)", () => {
  beforeEach(async () => {
    await db()`truncate sim_jobs, sim_groups, sim_chunks, sim_move_sums, worker_tasks, job_locks,
      cpu_log, move_results, view_cache restart identity`;
  });
  afterAll(async () => {
    await db().end();
  });

  it("gives concurrent runners disjoint chunks", async () => {
    const id = await insertJob();
    const got = await Promise.all(Array.from({ length: 8 }, () => nextAssignment(4, id, 2)));
    const chunks = got.flatMap((a) => a!.chunks);
    expect(chunks).toHaveLength(32);
    expect([...new Set(chunks)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 32 }, (_, i) => i),
    );
    const [job] = await db()`select status, last_worker_at from sim_jobs where id = ${id}`;
    expect(job!.status).toBe("running");
    expect(job!.last_worker_at).not.toBeNull();
  });

  it("never hands out chunks past a group's limit", async () => {
    const id = await insertJob();
    await db()`update sim_groups set next_chunk = 78 where job_id = ${id}`;
    const a = await nextAssignment(4, id, 2);
    expect(a!.chunks).toEqual([78, 79]);
    expect(await nextAssignment(4, id, 2)).toBeNull();
  });

  it("hands out the newest live job, and none that's superseded or done", async () => {
    await insertJob({ status: "done" });
    const older = await insertJob();
    const newer = await insertJob();
    expect(Number((await nextAssignment(2, null))!.jobId)).toBe(newer);
    await db()`update sim_jobs set status = 'superseded' where id = ${newer}`;
    expect(Number((await nextAssignment(2, null))!.jobId)).toBe(older);
    await db()`update sim_jobs set status = 'done' where id = ${older}`;
    expect(await nextAssignment(2, null)).toBeNull();
  });

  it("sends a job's setup and moves only to a runner that doesn't hold them", async () => {
    const id = await insertJob();
    const a = await nextAssignment(2, null);
    expect(a!.setup).toEqual({ synthetic: true });
    expect(a!.moves!.map((m) => m.key)).toEqual(KEYS);
    const held = await nextAssignment(2, id, KEYS.length);
    expect(held).not.toHaveProperty("setup");
    expect(held).not.toHaveProperty("moves");
    // A racing promotion added moves since: the runner gets them all again.
    expect(await nextAssignment(2, id, 1)).toHaveProperty("moves");
  });

  it("reads the live job's deep checks, whole or cut to the moves asked for", async () => {
    const id = await insertJob({ status: "running" });
    const effects = [
      { key: "1:2", active: true },
      { key: "3:4", active: false },
    ];
    // Stored as refreshJob does, with the id as a runner posts it back (a string).
    await writeView(DEEP_KEY, "", { jobId: String(id), effects }, 0);
    const whole = await liveJob(false);
    expect([...whole!.effects!.keys()]).toEqual(["1:2", "3:4"]);
    const cut = await liveJob(false, { keys: ["3:4"] });
    expect([...cut!.effects!.keys()]).toEqual(["3:4"]);
    expect(cut).toMatchObject({ live: true, settled: 1, total: 2 });
    const byAdd = await liveJob(false, { adds: ["1"] });
    expect([...byAdd!.effects!.keys()]).toEqual(["1:2"]);
    // Another job's checks aren't this job's.
    await writeView(DEEP_KEY, "", { jobId: String(id + 1), effects }, 0);
    expect((await liveJob(false, { keys: ["3:4"] }))!.effects).toBeNull();
  });

  it("queues one live task per input, and a newer input replaces a queued one", async () => {
    expect(await enqueueTask("trade-search", "a", { n: 1 })).toBe(true);
    expect(await enqueueTask("trade-search", "a", { n: 1 })).toBe(false);
    expect(await enqueueTask("trade-search", "b", { n: 2 })).toBe(true);
    const rows = await db()`select fingerprint, status from worker_tasks order by id`;
    expect(rows.map((r) => [r.fingerprint, r.status])).toEqual([
      ["a", "superseded"],
      ["b", "queued"],
    ]);
  });

  it("claims the oldest task once, with its input, and closes it", async () => {
    await enqueueTask("trade-search", "a", { n: 1 });
    await enqueueTask("trade-with", "b", { n: 2 });
    const [first, second, third] = await Promise.all([claimTask(), claimTask(), claimTask()]);
    const claimed = [first, second, third].filter((t) => t != null);
    expect(claimed.map((t) => t.kind).sort()).toEqual(["trade-search", "trade-with"]);
    const search = claimed.find((t) => t.kind === "trade-search")!;
    expect(search.input).toEqual({ n: 1 });
    expect(await finishTask(search.id)).toEqual({ kind: "trade-search", fingerprint: "a" });
    // Closed already: a second close finds nothing running.
    expect(await finishTask(search.id)).toBeNull();
    const [row] = await db()`select status, input_gz from worker_tasks where id = ${search.id}`;
    expect(row).toMatchObject({ status: "done", input_gz: null });
  });

  it("hands a quiet task out again, three tries at most", async () => {
    await enqueueTask("trade-search", "a", { n: 1 });
    const quiet = () => db()`update worker_tasks set started_at = now() - interval '6 minutes'`;
    const first = await claimTask();
    // Its runner is still inside the lease: nobody else gets it.
    expect(await claimTask()).toBeNull();
    await quiet();
    expect((await claimTask())!.id).toBe(first!.id);
    await quiet();
    expect((await claimTask())!.id).toBe(first!.id);
    await quiet();
    expect(await claimTask()).toBeNull();
    const [row] = await db()`select attempts from worker_tasks`;
    expect(row!.attempts).toBe(3);
  });

  it("prunes old jobs with their chunks, keeping the last finished one", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    const stale = await insertJob({ status: "superseded", created_at: old });
    const lastDone = await insertJob({ status: "done", created_at: old });
    const live = await insertJob();
    await db()`insert into sim_chunks (job_id, chunk, result) values (${stale}, 0, '{}')`;
    expect(await pruneSimJobs()).toBe(1);
    const left = await db()<{ id: string }[]>`select id from sim_jobs order by id`;
    expect(left.map((r) => Number(r.id))).toEqual([lastDone, live]);
    const [chunks] = await db()`select count(*)::int as n from sim_chunks`;
    const [groups] = await db()`select count(*)::int as n from sim_groups`;
    expect([chunks!.n, groups!.n]).toEqual([0, 2]);
  });

  it("prunes finished tasks after two days, never live ones", async () => {
    await enqueueTask("trade-search", "a", { n: 1 });
    await enqueueTask("trade-with", "b", { n: 2 });
    await finishTask((await claimTask())!.id);
    await db()`update worker_tasks set created_at = now() - interval '3 days'`;
    expect(await pruneTasks()).toBe(1);
    const rows = await db()`select kind, status from worker_tasks`;
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["trade-with", "queued"]]);
  });
});
