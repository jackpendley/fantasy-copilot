// The season-simulation worker (ADR-053), run by .github/workflows/simulate.yml on GitHub's
// machines. It asks the app for chunks of seasons, plays each on its own CPU core with the
// same engine as the app (packages/fantasy-core), and posts the results back. It needs only
// APP_URL and WORKER_SECRET: no ESPN cookies, no database.
//
//   APP_URL=https://fantasycopilot.vercel.app WORKER_SECRET=... node worker.mjs

import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { runChunk, type ChunkResult, type WireInput, type WireMove } from "../src/sim-wire";

interface Task {
  setup: WireInput;
  teamId: number;
  moves: WireMove[];
  chunk: number;
  seasons: number;
  replays: number;
}

interface Assignment {
  jobId: number;
  /** The group of moves these chunks are for (absent from apps deployed before Nov 5). */
  group?: number;
  teamId: number;
  replays: number;
  chunkSeasons: number;
  chunks: number[];
  active: string[];
  setup?: WireInput;
  moves?: WireMove[];
}

if (!isMainThread) {
  parentPort!.on("message", (t: Task) => {
    parentPort!.postMessage(runChunk(t.setup, t.teamId, t.moves, t.chunk, t.seasons, t.replays));
  });
} else {
  await main();
}

async function main() {
  const app = (process.env.APP_URL || "https://fantasycopilot.vercel.app").replace(/\/$/, "");
  const secret = process.env.WORKER_SECRET;
  if (!secret) throw new Error("WORKER_SECRET is not set");
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const cores = availableParallelism();
  const pool = Array.from({ length: cores }, () => new Worker(new URL(import.meta.url)));
  const run = (w: Worker, t: Task) =>
    new Promise<ChunkResult>((resolve, reject) => {
      // Each call removes the other listener, so they don't pile up on the thread.
      const onMessage = (r: ChunkResult) => {
        w.off("error", onError);
        resolve(r);
      };
      const onError = (e: Error) => {
        w.off("message", onMessage);
        reject(e);
      };
      w.once("message", onMessage);
      w.once("error", onError);
      w.postMessage(t);
    });
  const deadline = Date.now() + 25 * 60_000;
  let job: { id: number; setup: WireInput; moves: WireMove[] } | null = null;
  let posted = 0;
  const t0 = Date.now();
  // With nothing to simulate, wait while the app still has tasks under way (a job's moves are
  // built by a task first), up to this long.
  const WAIT_MS = 3 * 60_000;
  let idleSince: number | null = null;

  try {
    while (Date.now() < deadline) {
      const res = await fetch(
        // Two chunks per core per request: half the requests (and posts) the app answers.
        `${app}/api/worker/next?count=${2 * cores}${job ? `&have=${job.id}&moves=${job.moves.length}` : ""}`,
        { headers },
      );
      if (res.status === 204) {
        idleSince ??= Date.now();
        const peek = await fetch(`${app}/api/worker/peek`, { headers });
        if (peek.status !== 200 || Date.now() - idleSince > WAIT_MS) break;
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      idleSince = null;
      if (!res.ok) throw new Error(`next: HTTP ${res.status}`);
      const a = (await res.json()) as Assignment;
      if (a.setup && a.moves) job = { id: a.jobId, setup: a.setup, moves: a.moves };
      if (!job || job.id !== a.jobId) {
        job = null; // a newer job: ask again for its input
        continue;
      }
      const moves = job.moves.filter((m) => a.active.includes(m.key));
      const current = job;
      const post = async (body: object) => {
        const r = await fetch(`${app}/api/worker/result`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`result: HTTP ${r.status}`);
      };
      // Each thread plays its chunks one after another (a thread answers one at a time).
      const perThread = pool.map((_, t) => a.chunks.filter((_, i) => i % pool.length === t));
      const results = (
        await Promise.all(
          perThread.map(async (mine, t) => {
            const out: ChunkResult[] = [];
            for (const chunk of mine) {
              const result = await run(pool[t]!, {
                setup: current.setup,
                teamId: a.teamId,
                moves,
                chunk,
                seasons: a.chunkSeasons,
                replays: a.replays,
              });
              // An app from before groups takes one chunk per post.
              if (a.group == null) await post({ jobId: a.jobId, result });
              out.push(result);
            }
            return out;
          }),
        )
      ).flat();
      // One post per round: the app updates the checks once for all of them.
      if (a.group != null) await post({ jobId: a.jobId, group: a.group, results });
      posted += results.length;
    }
  } finally {
    await Promise.all(pool.map((w) => w.terminate()));
  }
  console.log(
    `posted ${posted} chunks on ${cores} cores in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
}
