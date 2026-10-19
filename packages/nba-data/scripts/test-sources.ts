// Smoke-test every live data source the app depends on. No database needed.
//   pnpm test:sources            (from the repo root)
// The private-league check runs only when ESPN_S2 / ESPN_SWID / ESPN_LEAGUE_ID are set
// (it reads apps/nba-manager/.env.local if present).

import { existsSync, readFileSync } from "node:fs";
import {
  fetchLeague,
  fetchProSchedule,
  parseProSchedule,
  parseSettings,
  parseTeams,
} from "@fantasy-copilot/espn";
import { fetchDailyLineups, fetchInjuries, fetchScoreboard } from "../src/index.js";

const envFile = new URL("../../../apps/nba-manager/.env.local", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!;
  }
}

const season = Number(process.env.ESPN_SEASON ?? 2027);
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const detail = await fn();
    console.log(`ok    ${name.padEnd(28)} ${String(Date.now() - t).padStart(5)}ms  ${detail}`);
  } catch (e) {
    failed++;
    console.log(
      `FAIL  ${name.padEnd(28)} ${String(Date.now() - t).padStart(5)}ms  ${(e as Error).message}`,
    );
  }
}

await check("ESPN NBA schedule", async () => {
  const games = parseProSchedule(await fetchProSchedule(season));
  return `${games.length} games, first ${new Date(games[0]!.date).toISOString()}`;
});
await check("ESPN scoreboard (opening night)", async () => {
  const g = await fetchScoreboard("20261020");
  return `${g.length} games, lines on ${g.filter((x) => x.spread != null).length}`;
});
await check("ESPN injuries", async () => {
  const rows = await fetchInjuries();
  return `${rows.length} players listed`;
});
await check("NBA daily lineups (past date)", async () => {
  const rows = await fetchDailyLineups("20260410");
  if (!rows) throw new Error("not published");
  return `${rows.length} players, ${rows.filter((r) => r.starter).length} starters`;
});
await check("NBA daily lineups (today)", async () => {
  const rows = await fetchDailyLineups(ymd(new Date()));
  return rows ? `${rows.length} players` : "not published yet (normal before game days)";
});

const { ESPN_S2, ESPN_SWID, ESPN_LEAGUE_ID, ESPN_TEAM_ID } = process.env;
if (ESPN_S2 && ESPN_SWID && ESPN_LEAGUE_ID) {
  await check("ESPN private league", async () => {
    const data = await fetchLeague(
      { s2: ESPN_S2, swid: ESPN_SWID, leagueId: ESPN_LEAGUE_ID, season },
      ["mSettings", "mRoster", "mTeam"],
    );
    const s = parseSettings(data);
    const mine = parseTeams(data).find((t) => t.id === Number(ESPN_TEAM_ID));
    return `${s.name}: ${Object.keys(s.scoring).length} scoring stats, my roster ${mine?.roster.length ?? "?"} players`;
  });
} else {
  console.log(
    "skip  ESPN private league           set ESPN_S2/ESPN_SWID/ESPN_LEAGUE_ID in apps/nba-manager/.env.local",
  );
}

process.exit(failed ? 1 : 0);
