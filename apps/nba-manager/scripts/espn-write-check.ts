// One-off verification of the ESPN write path, run only with Jack's explicit approval:
// swap two players who both have NO game on the chosen day (zero points impact), confirm
// by re-reading the roster, then swap them back and confirm again. Both writes are audited.
//
//   node --env-file=.env.local --import tsx scripts/espn-write-check.ts <YYYY-MM-DD> <starterId> <benchId> --confirm

import {
  fetchLeague,
  fetchProSchedule,
  parseProSchedule,
  parseTeams,
  submitLineup,
  type EspnConfig,
} from "@fantasy-copilot/espn";
import { appendFileSync, mkdirSync } from "node:fs";
import { scoringPeriodForDate } from "../lib/calendar";

const [date, starterArg, benchArg, flag] = process.argv.slice(2);
if (!date || !starterArg || !benchArg || flag !== "--confirm") {
  console.error("usage: espn-write-check.ts <YYYY-MM-DD> <starterId> <benchId> --confirm");
  process.exit(2);
}
const { ESPN_S2, ESPN_SWID, ESPN_LEAGUE_ID, ESPN_TEAM_ID, ESPN_SEASON } = process.env;
const cfg: EspnConfig = {
  s2: ESPN_S2!,
  swid: ESPN_SWID!,
  leagueId: ESPN_LEAGUE_ID!,
  season: Number(ESPN_SEASON || 2027),
};
const teamId = Number(ESPN_TEAM_ID);
const sp = scoringPeriodForDate(date);
const starterId = Number(starterArg);
const benchId = Number(benchArg);

const audit = (entry: object) => {
  mkdirSync("data/local", { recursive: true });
  appendFileSync(
    "data/local/espn-actions.jsonl",
    JSON.stringify({ at: new Date().toISOString(), kind: "lineup-check", ...entry }) + "\n",
  );
};

async function roster() {
  const raw = await fetchLeague(cfg, ["mRoster"], { scoringPeriodId: sp });
  const me = parseTeams(raw).find((t) => t.id === teamId);
  if (!me) throw new Error("team not found");
  return me.roster;
}

const games = parseProSchedule(await fetchProSchedule(cfg.season)).filter(
  (g) => g.scoringPeriodId === sp,
);
const playing = new Set(games.flatMap((g) => [g.homeProTeamId, g.awayProTeamId]));

const before = await roster();
const a = before.find((p) => p.id === starterId);
const b = before.find((p) => p.id === benchId);
if (!a || !b) throw new Error("player not on the roster");
if (playing.has(a.proTeamId) || playing.has(b.proTeamId)) {
  throw new Error("refusing: one of the players has a game that day");
}
if (a.slot === "BE" || b.slot !== "BE")
  throw new Error("expected one starter and one bench player");
const startSlot = a.slot!;
console.log(`sp ${sp} (${date}): ${a.name} ${startSlot} <-> ${b.name} BE; neither plays`);

async function swap(label: string, moves: { playerId: number; from: string; to: string }[]) {
  const res = await submitLineup(cfg, teamId, sp, moves);
  audit({ label, scoringPeriodId: sp, request: moves, ...res });
  console.log(
    `${label}: ${res.ok ? "ok" : "REJECTED"} http ${res.httpStatus} ${res.code} ${res.message}`,
  );
  if (!res.ok) process.exit(1);
  const now = await roster();
  for (const m of moves) {
    const p = now.find((x) => x.id === m.playerId);
    console.log(`  confirm ${p?.name}: now ${p?.slot} (expected ${m.to})`);
    if (p?.slot !== m.to) {
      console.error("  MISMATCH: stopping. Check the lineup in the ESPN app.");
      process.exit(1);
    }
  }
}

await swap("swap", [
  { playerId: a.id, from: startSlot, to: "BE" },
  { playerId: b.id, from: "BE", to: startSlot },
]);
await swap("swap back", [
  { playerId: b.id, from: startSlot, to: "BE" },
  { playerId: a.id, from: "BE", to: startSlot },
]);
console.log("Write path verified; lineup restored.");
