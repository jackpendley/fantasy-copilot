// Seasons before ESPN's player pool (MODEL_CARD, teammate returns test 6): every regular-season
// box score, from each team's schedule, built into per-player game logs in the format
// scripts/fetch-history.ts caches, so scripts/teammate-return-events.ts reads them unchanged
// (HISTORY_CACHE=data/local/backtest-boxscores/). Public ESPN site API, no cookies; at most four
// requests at a time. Each game's player lines are kept as they arrive, so a re-run resumes; a
// failed game isn't kept, and a season's logs are written only once every game is in.
// Positions are ESPN's current labels (it has no past ones): kept for description only.
//
//   node --conditions=react-server --import tsx scripts/fetch-history-boxscores.ts 1994 2017
//   (seasons by end year: 1993-94 to 2016-17)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { parseBox, type BoxGame } from "./boxscore-parse";

const CACHE = new URL("../data/local/backtest-boxscores/", import.meta.url);
const BOX = new URL("box/", CACHE);
mkdirSync(BOX, { recursive: true });
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
async function getJson(url: string): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= 3) throw e;
      await sleep(2_000 * 2 ** i);
    }
  }
}

/** A season's regular-season game ids, from every team's schedule (ESPN team ids 1-30). */
async function gameIds(end: number): Promise<number[]> {
  const file = new URL(`games-${end}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const ids = new Set<number>();
  for (let team = 1; team <= 30; team++) {
    const s = await getJson(`${SITE}/teams/${team}/schedule?season=${end}&seasontype=2`);
    for (const e of s.events ?? []) ids.add(Number(e.id));
    await sleep(250);
  }
  const list = [...ids].sort((a, b) => a - b);
  writeFileSync(file, JSON.stringify(list));
  return list;
}

/** ESPN's current label -> the position ids the pool uses (1 guard, 3 forward, 5 center). */
const posId = (abbr: string) => (/^C/.test(abbr) ? 5 : /G/.test(abbr) ? 1 : 3);

async function season(end: number) {
  const ids = await gameIds(end);
  const todo = ids.filter((id) => !existsSync(new URL(`${id}.json`, BOX)));
  let failed = 0;
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (id) => {
        try {
          const box = parseBox(id, await getJson(`${SITE}/summary?event=${id}`));
          writeFileSync(new URL(`${id}.json`, BOX), JSON.stringify(box));
        } catch {
          failed++;
        }
      }),
    );
    await sleep(250);
    if (i % 200 === 0) console.log(`  ${end}: ${i}/${todo.length} fetched`);
  }
  if (failed) {
    console.log(`${end - 1}-${String(end).slice(2)}: ${failed} games failed; re-run to finish`);
    return false;
  }
  // Every game is in: each player's log, oldest first, and his (current) position label.
  const logs = new Map<number, GameLogEntry[]>();
  const pos: Record<number, number> = {};
  for (const id of ids) {
    const box = JSON.parse(readFileSync(new URL(`${id}.json`, BOX), "utf8")) as BoxGame;
    for (const side of box.sides)
      for (const p of side.players) {
        pos[p.id] = posId(p.pos);
        const log = logs.get(p.id) ?? [];
        log.push({
          gameId: box.gameId,
          date: box.date,
          opponent: side.opponent,
          home: side.home,
          result: "",
          score: "",
          part: "regular",
          line: p.line,
        });
        logs.set(p.id, log);
      }
  }
  for (const [id, log] of logs) {
    log.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    writeFileSync(new URL(`${id}-${end}.json`, CACHE), JSON.stringify(log));
  }
  writeFileSync(new URL(`positions-${end}.json`, CACHE), JSON.stringify(pos));
  console.log(
    `${end - 1}-${String(end).slice(2)}: ${ids.length} games, ${logs.size} players, logs written`,
  );
  return true;
}

const [from, to] = process.argv.slice(2).map(Number);
if (from && to) {
  let ok = true;
  for (let end = from; end <= to; end++) ok = (await season(end)) && ok;
  if (!ok) process.exitCode = 1;
}
