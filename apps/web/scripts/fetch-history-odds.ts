// Past seasons' closing game lines (MODEL_CARD, teammate absences by impact, re-run with game
// environment): ESPN's public core API, the median over the books it lists (parseGameOdds).
// Cached as odds-{season}.json beside the season's logs: gameId → line, or null when ESPN has
// none. Lines are pregame inputs, not outcomes. Read-only; at most four requests at a time; a
// failed request isn't cached, so a re-run picks it up. Game ids come from the season's
// schedule file (box-score cache) or its players' logs.
//
//   node --conditions=react-server --import tsx scripts/fetch-history-odds.ts data/local/backtest-boxscores 2011 2017
//   node --conditions=react-server --import tsx scripts/fetch-history-odds.ts data/local/backtest 2019 2025

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchGameOdds, type GameOdds } from "@fantasy-copilot/nba-data";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gameIds(cache: URL, end: number): number[] {
  const schedule = new URL(`games-${end}.json`, cache);
  if (existsSync(schedule)) return JSON.parse(readFileSync(schedule, "utf8"));
  const ids = new Set<number>();
  for (const f of readdirSync(cache).filter((f) => f.endsWith(`-${end}.json`) && /^\d+-/.test(f)))
    for (const g of JSON.parse(readFileSync(new URL(f, cache), "utf8")) as { gameId: number }[])
      ids.add(g.gameId);
  return [...ids].sort((a, b) => a - b);
}

async function season(cache: URL, end: number) {
  const file = new URL(`odds-${end}.json`, cache);
  const lines: Record<string, GameOdds | null> = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const ids = gameIds(cache, end);
  const todo = ids.filter((id) => !(id in lines));
  let failed = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (id) => {
        try {
          lines[id] = await fetchGameOdds(id);
        } catch {
          failed++;
        }
      }),
    );
    await sleep(250);
    if (i % 400 === 0) writeFileSync(file, JSON.stringify(lines));
  }
  writeFileSync(file, JSON.stringify(lines));
  const have = ids.filter((id) => lines[id]).length;
  console.log(
    `${end - 1}-${String(end).slice(2)}: ${ids.length} games, ${have} with a line (${((100 * have) / ids.length).toFixed(1)}%)` +
      (failed ? `, ${failed} failed (re-run)` : ""),
  );
  return !failed;
}

const [dir, from, to] = process.argv.slice(2);
if (!dir || !Number(from) || !Number(to)) throw new Error("usage: <cache dir> <from> <to>");
const cache = pathToFileURL(`${resolve(dir)}/`);
let ok = true;
for (let end = Number(from); end <= Number(to); end++) ok = (await season(cache, end)) && ok;
if (!ok) process.exitCode = 1;
