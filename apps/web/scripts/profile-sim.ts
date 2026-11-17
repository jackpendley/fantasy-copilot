// Where the season simulator spends its time (streaming attempt 3, MODEL_CARD): snapshot the
// league's simulation input once, then time either rule on it offline, under `--cpu-prof` for a
// profile. The snapshot holds league data, so it stays in data/local/ (gitignored).
//
//   SNAPSHOT=1 node --env-file=.env.local --conditions=react-server --import tsx scripts/profile-sim.ts
//   FIT=1 SEASONS=1000 node --cpu-prof --cpu-prof-dir=data/local/prof --import tsx scripts/profile-sim.ts
//   node --import tsx scripts/profile-sim.ts summarize data/local/prof/<file>.cpuprofile

import { readFileSync, writeFileSync } from "node:fs";
import { fromWire, simulateSeason, toWire, type WireInput } from "@fantasy-copilot/fantasy-core";

const SNAP = new URL("../data/local/sim-input.json", import.meta.url);
/** The profiling seed (attempt 3's pre-registered run uses a different one). */
const SEED = 20261116;

async function snapshot() {
  const { buildOutlookInput } = await import("../lib/nba/outlook");
  const { outlookSetup } = await import("../lib/nba/outlook-run");
  const setup = await outlookSetup();
  const { data } = setup;
  const { input } = buildOutlookInput({
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
    seasons: 1,
  });
  writeFileSync(SNAP, JSON.stringify(toWire(input)));
  console.log(`Snapshot of day ${setup.fromDay}: ${input.teams.length} teams.`);
}

function time() {
  const seasons = Number(process.env.SEASONS || 1000);
  const fitStreams = process.env.FIT === "1";
  const input = fromWire(JSON.parse(readFileSync(SNAP, "utf8")) as WireInput, {
    seasons,
    seed: SEED,
  });
  const t0 = process.cpuUsage();
  simulateSeason({ ...input, fitStreams });
  const cpu = process.cpuUsage(t0);
  console.log(
    `${fitStreams ? "fit" : "raw"}: ${((cpu.user + cpu.system) / 1000 / seasons).toFixed(2)} ms per season (${seasons} seasons)`,
  );
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
}

/** Self time by function, from a .cpuprofile (samples × interval). */
function summarize(file: string) {
  const p = JSON.parse(readFileSync(file, "utf8")) as {
    nodes: ProfileNode[];
    samples: number[];
    timeDeltas: number[];
  };
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  let total = 0;
  p.samples.forEach((id, i) => {
    const n = byId.get(id)!;
    const f = n.callFrame;
    const where = f.url ? `${f.url.split("/").slice(-2).join("/")}:${f.lineNumber + 1}` : "";
    const key = `${f.functionName || "(anonymous)"} ${where}`.trim();
    const dt = p.timeDeltas[i] ?? 0;
    self.set(key, (self.get(key) ?? 0) + dt);
    total += dt;
  });
  console.log(`| Function | self ms | share |\n|---|---|---|`);
  for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`| ${k} | ${(us / 1000).toFixed(0)} | ${((100 * us) / total).toFixed(1)}% |`);
}

if (process.argv[2] === "summarize") summarize(process.argv[3]!);
else if (process.env.SNAPSHOT) await snapshot();
else time();
