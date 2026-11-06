// The worker's task runner (docs/COMPUTE.md), run by .github/workflows/simulate.yml next to the
// simulation runners. It claims tasks from the app (lib/nba/worker-tasks.ts), computes them
// with the app's own code and posts the results. Like the simulator it needs only APP_URL and
// WORKER_SECRET: no ESPN cookies, no database.
//
//   APP_URL=https://fantasycopilot.vercel.app WORKER_SECRET=... node tasks.mjs

import { buildSimMoves, type SimBuildInput } from "../lib/nba/sim-moves";
import { runTradeFor, runTradeSearch, type TradeSearchInput } from "../lib/nba/trade-task";
import { decodeWire } from "../lib/wire-json";

const HANDLERS: Record<string, (input: never) => unknown> = {
  "trade-search": (input: TradeSearchInput) => runTradeSearch(input),
  // The Interested list's "Trade for him" packages.
  "trade-for": (input: TradeSearchInput & { targets: number[] }) => runTradeFor(input),
  // A simulation job's moves: the add-and-drop analysis, then each move built (ADR-059).
  "sim-build": (input: { build: unknown }) => buildSimMoves(decodeWire<SimBuildInput>(input.build)),
};

/**
 * Wait between asks with nothing to do, how long to stay that way, and the wait while only
 * simulations are under way (a task then is rare; each ask costs the app a request).
 */
const POLL_MS = 15_000;
const IDLE_MS = 2 * 60_000;
const STAY_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = (process.env.APP_URL || "https://fantasycopilot.vercel.app").replace(/\/$/, "");
  const secret = process.env.WORKER_SECRET;
  if (!secret) throw new Error("WORKER_SECRET is not set");
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const deadline = Date.now() + 25 * 60_000;
  let lastWork = Date.now();
  let done = 0;

  while (Date.now() < deadline) {
    const res = await fetch(`${app}/api/worker/task`, { headers });
    if (res.status === 200) {
      const task = (await res.json()) as { id: number; kind: string; input: never };
      const t0 = Date.now();
      let body: object;
      try {
        const run = HANDLERS[task.kind];
        if (!run) throw new Error(`unknown task kind ${task.kind}`);
        body = { id: task.id, result: run(task.input) };
      } catch (e) {
        body = { id: task.id, error: (e as Error).message };
      }
      const r = await fetch(`${app}/api/worker/task`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`task result: HTTP ${r.status}`);
      console.log(`${task.kind} #${task.id}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      done++;
      lastWork = Date.now();
      continue;
    }
    // 202: nothing now, but simulations are under way (they often bring tasks): stay.
    if (res.status === 202) {
      lastWork = Date.now();
      await sleep(STAY_MS);
      continue;
    }
    if (res.status !== 204) throw new Error(`task: HTTP ${res.status}`);
    if (Date.now() - lastWork > IDLE_MS) break;
    await sleep(POLL_MS);
  }
  console.log(`ran ${done} tasks`);
}

await main();
