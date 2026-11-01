// How much one player's fantasy points swing in a game around his expectation (his previous 20
// games), by expectation: the per-start spread of win-probability candidate C (MODEL_CARD.md,
// "Weekly win probability", Pre-registration 3). Reads the game logs cached by
// backtest-projection.ts (data/local/backtest/, 2024-25 and 2025-26); read-only.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/fit-start-sd.ts

import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { espnConfig } from "../lib/env";

const CACHE = new URL("../data/local/backtest/", import.meta.url);
const BUCKET = 2.5;

/** SD = a + b x projection, from the cached game logs of `seasons` (named by end year). */
export function fitStartSd(scoring: ScoringMap, seasons: number[], print = false) {
  const files = new RegExp(`-(${seasons.join("|")})\\.json$`);
  const buckets = new Map<number, { n: number; sse: number }>();
  for (const f of readdirSync(CACHE).filter((f) => files.test(f))) {
    const raw: unknown = JSON.parse(readFileSync(new URL(f, CACHE), "utf8"));
    if (!Array.isArray(raw)) continue;
    const fps = (raw as GameLogEntry[])
      .filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((g) => fantasyPoints(withDerived(g.line), scoring));
    for (let i = 10; i < fps.length; i++) {
      const prev = fps.slice(Math.max(0, i - 20), i);
      const expected = prev.reduce((a, x) => a + x, 0) / prev.length;
      if (expected < 10) continue;
      const b = Math.min(50, Math.floor(expected / BUCKET) * BUCKET);
      const r = buckets.get(b) ?? { n: 0, sse: 0 };
      r.n++;
      r.sse += (fps[i]! - expected) ** 2;
      buckets.set(b, r);
    }
  }
  // SD by bucket, then a line through them weighted by games.
  let w = 0,
    x = 0,
    y = 0,
    xx = 0,
    xy = 0;
  for (const [b, r] of [...buckets].sort((p, q) => p[0] - q[0])) {
    const mid = b + BUCKET / 2;
    const sd = Math.sqrt(r.sse / r.n);
    if (print) console.log(`${b}-${b + BUCKET}`.padEnd(10), String(r.n).padStart(6), sd.toFixed(1));
    w += r.n;
    x += r.n * mid;
    y += r.n * sd;
    xx += r.n * mid * mid;
    xy += r.n * mid * sd;
  }
  const b = (w * xy - x * y) / (w * xx - x * x);
  return { a: (y - b * x) / w, b, games: w };
}

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const { a, b, games } = fitStartSd(scoring, [2025, 2026], true);
  console.log(`games ${games}; SD = ${a.toFixed(2)} + ${b.toFixed(3)} x projection`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
