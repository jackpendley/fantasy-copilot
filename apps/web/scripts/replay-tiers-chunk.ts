// One core of scripts/replay-tiers.ts: plays a chunk of seasons for a group of moves, as the
// simulation worker does (packages/fantasy-core/worker/worker.ts).

import { parentPort } from "node:worker_threads";
import { runChunk, type WireInput, type WireMove } from "@fantasy-copilot/fantasy-core";

parentPort!.on(
  "message",
  (t: {
    setup: WireInput;
    teamId: number;
    moves: WireMove[];
    chunk: number;
    seasons: number;
    replays: number;
  }) => {
    parentPort!.postMessage(runChunk(t.setup, t.teamId, t.moves, t.chunk, t.seasons, t.replays));
  },
);
