// Past seasons' game logs and positions for every player who played (MODEL_CARD, teammate
// returns test 2): ESPN's public season pool lists the players and their default position;
// each player's public game log is cached beside the others in data/local/backtest/
// (gitignored). Read-only; a failed fetch isn't cached, so a re-run picks it up.
//
//   node --conditions=react-server --import tsx scripts/fetch-history.ts 2021 2022 2023 2024

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fetchSeasonPool } from "@fantasy-copilot/espn";
import { fetchGameLog } from "@fantasy-copilot/nba-data";

const CACHE = new URL("../data/local/backtest/", import.meta.url);
mkdirSync(CACHE, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PoolPlayer {
  player: {
    id: number;
    defaultPositionId: number;
    stats?: { id: string; stats?: Record<string, number> }[];
  };
}

async function season(end: number) {
  const pool = ((await fetchSeasonPool(end)) as { players: PoolPlayer[] }).players;
  // Played that regular season: its season-total row (id "00" + season) has games (stat 42).
  const played = pool.filter((p) =>
    p.player.stats?.some((s) => s.id === `00${end}` && (s.stats?.["42"] ?? 0) > 0),
  );
  writeFileSync(
    new URL(`positions-${end}.json`, CACHE),
    JSON.stringify(
      Object.fromEntries(played.map((p) => [p.player.id, p.player.defaultPositionId])),
    ),
  );
  let fetched = 0;
  let failed = 0;
  const todo = played.filter((p) => !existsSync(new URL(`${p.player.id}-${end}.json`, CACHE)));
  // Four at a time, a pause between batches (ESPN's site API refuses bursts).
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (p) => {
        try {
          const log = await fetchGameLog(p.player.id, end);
          writeFileSync(new URL(`${p.player.id}-${end}.json`, CACHE), JSON.stringify(log));
          fetched++;
        } catch {
          failed++;
        }
      }),
    );
    await sleep(400);
  }
  console.log(
    `${end - 1}-${String(end).slice(2)}: ${played.length} players played, ` +
      `${played.length - todo.length} cached, ${fetched} fetched, ${failed} failed`,
  );
}

for (const end of process.argv.slice(2).map(Number)) await season(end);
