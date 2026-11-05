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
  // While a job is being built (the app answers "wait"), ask again this often, up to WAIT_MS.
  const WAIT_EVERY_MS = 20_000;
  const WAIT_MS = 3 * 60_000;
  let waitingSince: number | null = null;
  // Two chunks per core per request: half the requests the app answers.
  const count = 2 * cores;
  type Step = { go: Assignment } | "wait" | "leave";
  const ask = async (): Promise<Step> => {
    const res = await fetch(
      `${app}/api/worker/next?count=${count}${job ? `&have=${job.id}&moves=${job.moves.length}` : ""}`,
      { headers },
    );
    if (res.status === 204) return "leave";
    if (res.status === 202) return "wait";
    if (!res.ok) throw new Error(`next: HTTP ${res.status}`);
    return { go: (await res.json()) as Assignment };
  };
  const post = async (body: object) => {
    const r = await fetch(`${app}/api/worker/result`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`result: HTTP ${r.status}`);
    return (await r.json()) as { next?: Assignment | null; wait?: boolean };
  };

  try {
    let step = await ask();
    while (Date.now() < deadline) {
      if (step === "leave") break;
      if (step === "wait") {
        waitingSince ??= Date.now();
        if (Date.now() - waitingSince > WAIT_MS) break;
        await new Promise((r) => setTimeout(r, WAIT_EVERY_MS));
        step = await ask();
        continue;
      }
      waitingSince = null;
      const a = step.go;
      if (a.setup && a.moves) job = { id: a.jobId, setup: a.setup, moves: a.moves };
      if (!job || job.id !== a.jobId) {
        job = null; // a newer job: ask again for its input
        step = await ask();
        continue;
      }
      const moves = job.moves.filter((m) => a.active.includes(m.key));
      const current = job;
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
      posted += results.length;
      if (a.group == null) {
        step = await ask();
        continue;
      }
      // One request posts this round and takes the next chunks (an app from before that answers
      // without `next`: ask separately).
      const r = await post({
        jobId: a.jobId,
        group: a.group,
        results,
        next: { count, have: current.id, moves: current.moves.length },
      });
      step = r.next ? { go: r.next } : r.wait ? "wait" : r.next === null ? "leave" : await ask();
    }
  } finally {
    await Promise.all(pool.map((w) => w.terminate()));
  }
  console.log(
    `posted ${posted} chunks on ${cores} cores in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
}
