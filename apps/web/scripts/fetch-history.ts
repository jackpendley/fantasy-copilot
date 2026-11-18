// Past seasons' game logs and positions for every player who played (MODEL_CARD, teammate
// returns test 2): ESPN's public season pool lists the players and their default position;
// each player's public game log is cached beside the others in data/local/backtest/
// (gitignored). Read-only; a failed fetch isn't cached, so a re-run picks it up (a 404 is a
// player with no games that season, cached as empty). ESPN's pool starts at 2017-18; for an
// earlier season (priors only) next season's players are fetched, so seasons run newest first
// whatever the order given. A season not yet over is fetched again on every run.
//
//   node --conditions=react-server --import tsx scripts/fetch-history.ts 2021 2022 2023 2024
//   ... 2017 2018 2019 2020 2021   (test 3: 2017-18 to 2020-21, and 2016-17 as priors)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchSeasonPool } from "@fantasy-copilot/espn";
import { fetchGameLog } from "@fantasy-copilot/nba-data";

const CACHE = new URL("../data/local/backtest/", import.meta.url);
mkdirSync(CACHE, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The first season (by end year) ESPN's public pool serves. */
const FIRST_POOL = 2018;

interface PoolPlayer {
  player: {
    id: number;
    defaultPositionId: number;
    eligibleSlots?: number[];
    stats?: { id: string; stats?: Record<string, number> }[];
  };
}

/** Who to fetch for a season ESPN's pool doesn't serve (before 2017-18): next season's players, as priors. */
function priorsOnly(end: number): PoolPlayer[] {
  const next = new URL(`positions-${end + 1}.json`, CACHE);
  if (!existsSync(next)) throw new Error(`no pool for ${end}; fetch ${end + 1} first`);
  return Object.keys(JSON.parse(readFileSync(next, "utf8")) as Record<string, number>).map(
    (id) => ({ player: { id: Number(id), defaultPositionId: 0 } }),
  );
}

async function season(end: number) {
  // Before the pool's first season: priors only. From it on, any failure is an error (a passing
  // 404 mustn't quietly switch a real season to priors).
  const pool =
    end < FIRST_POOL ? null : ((await fetchSeasonPool(end)) as { players: PoolPlayer[] }).players;
  // Played that regular season: its season-total row (id "00" + season) has games (stat 42).
  const played = pool
    ? pool.filter((p) =>
        p.player.stats?.some((s) => s.id === `00${end}` && (s.stats?.["42"] ?? 0) > 0),
      )
    : priorsOnly(end);
  if (pool && !played.length) throw new Error(`ESPN's pool for ${end} lists no one who played`);
  if (pool)
    writeFileSync(
      new URL(`positions-${end}.json`, CACHE),
      JSON.stringify(
        Object.fromEntries(played.map((p) => [p.player.id, p.player.defaultPositionId])),
      ),
    );
  // Eligible positions too (ids 0-4: PG, SG, SF, PF, C), for the position cross-tabs (test 5).
  if (pool)
    writeFileSync(
      new URL(`eligible-${end}.json`, CACHE),
      JSON.stringify(
        Object.fromEntries(
          played.map((p) => [p.player.id, (p.player.eligibleSlots ?? []).filter((s) => s <= 4)]),
        ),
      ),
    );
  let fetched = 0;
  let failed = 0;
  // A season still under way is fetched again: its cached logs stop where the last run did.
  const over = Date.now() > Date.parse(`${end}-07-01`);
  const todo = played.filter(
    (p) => !over || !existsSync(new URL(`${p.player.id}-${end}.json`, CACHE)),
  );
  // Only that season's games (Aug to Sep; the 2020 bubble ran into October), so a later
  // season's games can never become an earlier season's priors.
  const from = Date.parse(`${end - 1}-08-01`);
  const to = Date.parse(`${end}-${end === 2020 ? "10-31" : "09-30"}`);
  // Four at a time, a pause between batches (ESPN's site API refuses bursts).
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (p) => {
        try {
          const log = (await fetchGameLog(p.player.id, end)).filter((g) => {
            const t = Date.parse(g.date);
            return t >= from && t <= to;
          });
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
    `${end - 1}-${String(end).slice(2)}: ${played.length} players ${pool ? "played" : "(next season's, as priors)"}, ` +
      `${played.length - todo.length} cached, ${fetched} fetched, ${failed} failed`,
  );
}

// Newest first: a priors-only season needs the next season's players.
for (const end of process.argv
  .slice(2)
  .map(Number)
  .sort((a, b) => b - a))
  await season(end);
