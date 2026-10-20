// Walk-forward backtest of the per-game projection on the 2025-26 season (read-only; no ESPN
// writes). For every game a player played, each predictor sees only what was known before
// tip: his 2024-25 per-game average (the prior) and his earlier 2025-26 games. Scored with
// this league's current scoring.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-projection.ts
//   TEST_SEASON=2025 ... tests 2024-25 instead (prior 2023-24). Seasons are named by end year.
//
// Game logs (public ESPN data) are cached in data/local/backtest/ (gitignored).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import { fetchGameLog, type GameLogEntry } from "@fantasy-copilot/nba-data";
import { espnConfig } from "../lib/env";
import { loadFreeAgents, loadLeague } from "../lib/nba/data";

const TEST = Number(process.env.TEST_SEASON || 2026);
const PRIOR = TEST - 1;
const CACHE = new URL("../data/local/backtest/", import.meta.url);
mkdirSync(CACHE, { recursive: true });

async function gameLog(id: number, season: number): Promise<GameLogEntry[]> {
  const file = new URL(`${id}-${season}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const log = await fetchGameLog(id, season).catch(() => []);
  writeFileSync(file, JSON.stringify(log));
  return log;
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

interface Game {
  fp: number;
  min: number;
}

/** A predictor: expected FP for the next game from the prior and the games so far. */
type Predictor = (prior: number, games: Game[]) => number;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const blend =
  (priorGames: number): Predictor =>
  (prior, games) =>
    games.length
      ? (games.length * mean(games.map((g) => g.fp)) + priorGames * prior) /
        (games.length + priorGames)
      : prior;

/** Recency-weighted season average (half-life in games), blended with the prior. */
const ewmaBlend =
  (priorGames: number, halfLife: number): Predictor =>
  (prior, games) => {
    if (!games.length) return prior;
    const decay = Math.pow(0.5, 1 / halfLife);
    let w = 0;
    let s = 0;
    games.forEach((g, i) => {
      const wi = Math.pow(decay, games.length - 1 - i);
      w += wi;
      s += wi * g.fp;
    });
    // Effective sample size of the weights, so the prior keeps its pull.
    const n = Math.min(
      games.length,
      (w * w) / games.reduce((a, _, i) => a + Math.pow(decay, 2 * (games.length - 1 - i)), 0),
    );
    return (n * (s / w) + priorGames * prior) / (n + priorGames);
  };

/** Scale by recent minutes vs his season minutes (role changes show up in minutes first). */
const minutesTrend =
  (base: Predictor, window: number, strength: number): Predictor =>
  (prior, games) => {
    const p = base(prior, games);
    if (games.length < window + 3) return p;
    const season = mean(games.map((g) => g.min));
    const recent = mean(games.slice(-window).map((g) => g.min));
    if (season <= 0) return p;
    const ratio = Math.min(1.4, Math.max(0.6, recent / season));
    return p * (1 + strength * (ratio - 1));
  };

async function main() {
  const cfg = espnConfig();
  // Player set: today's rostered players and top free agents (public ids).
  const [league, fas, settingsRaw] = await Promise.all([
    loadLeague(1, "2026-10-20"),
    loadFreeAgents(1),
    fetchLeague(cfg, ["mSettings"]),
  ]);
  const scoring: ScoringMap = parseSettings(settingsRaw).scoring;
  const ids = [
    ...new Set(
      [...league.teams.flatMap((t) => t.roster), ...fas.map((f) => f.player)].map((p) => p.id),
    ),
  ];
  console.log(`players: ${ids.length}; fetching game logs (cached after the first run)…`);
  const logs = await inBatches(ids, 8, async (id) => ({
    id,
    prev: await gameLog(id, PRIOR),
    cur: await gameLog(id, TEST),
  }));

  const predictors: Record<string, Predictor> = {
    "prior only (previous season avg)": (prior) => prior,
    "season-to-date only": (prior, g) => (g.length ? mean(g.map((x) => x.fp)) : prior),
    ...Object.fromEntries([5, 10, 15, 20, 30, 45].map((k) => [`blend PRIOR_GAMES=${k}`, blend(k)])),
    ...Object.fromEntries(
      [
        [15, 10],
        [15, 20],
        [10, 15],
        [20, 15],
      ].map(([k, h]) => [`recency blend k=${k} half-life=${h}`, ewmaBlend(k!, h!)]),
    ),
    "blend 15 + minutes trend (5 g, 0.5)": minutesTrend(blend(15), 5, 0.5),
    "blend 15 + minutes trend (10 g, 0.75)": minutesTrend(blend(15), 10, 0.75),
    "blend 10 + minutes trend (5 g, 0.5)": minutesTrend(blend(10), 5, 0.5),
    "recency k=10 hl=15 + minutes trend (5 g, 0.5)": minutesTrend(ewmaBlend(10, 15), 5, 0.5),
  };
  const BASELINE = "blend PRIOR_GAMES=15"; // what ships today
  /** Per player: mean error difference vs the baseline (negative = better). */
  const perPlayer: Record<string, number[]> = {};
  for (const k of Object.keys(predictors)) perPlayer[k] = [];

  const err: Record<string, { all: number[]; early: number[]; late: number[] }> = {};
  for (const k of Object.keys(predictors)) err[k] = { all: [], early: [], late: [] };
  let players = 0;
  for (const { prev, cur } of logs) {
    const fp = (g: GameLogEntry) => fantasyPoints(withDerived(g.line), scoring);
    const prevGames = prev.filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0);
    const curGames = cur.filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0);
    // Point in time: a prior needs a real 2024-25 sample; the player needs a 2025-26 season.
    if (prevGames.length < 20 || curGames.length < 20) continue;
    players++;
    const prior = mean(prevGames.map(fp));
    const seen: Game[] = [];
    const mine: Record<string, number[]> = {};
    for (const k of Object.keys(predictors)) mine[k] = [];
    for (const g of curGames) {
      const actual = fp(g);
      for (const [k, pred] of Object.entries(predictors)) {
        const e = Math.abs(pred(prior, seen) - actual);
        err[k]!.all.push(e);
        mine[k]!.push(e);
        (seen.length < 20 ? err[k]!.early : err[k]!.late).push(e);
      }
      seen.push({ fp: actual, min: g.line.MIN ?? 0 });
    }
    for (const k of Object.keys(predictors))
      perPlayer[k]!.push(mean(mine[k]!) - mean(mine[BASELINE]!));
  }

  const rows = Object.entries(err)
    .map(([k, e]) => ({
      k,
      mae: mean(e.all),
      early: mean(e.early),
      late: mean(e.late),
      n: e.all.length,
    }))
    .sort((a, b) => a.mae - b.mae);
  console.log(
    `\n${players} players, ${rows[0]!.n} player-games (${TEST - 1}-${String(TEST).slice(2)} regular season, prior ${PRIOR - 1}-${String(PRIOR).slice(2)})\n`,
  );
  console.log(
    `| Predictor | MAE (FP/game) | Games 1-20 | Games 21+ | vs ${BASELINE} (95% CI, by player) |`,
  );
  console.log("|---|---:|---:|---:|---|");
  for (const r of rows) {
    const d = perPlayer[r.k]!;
    const m = mean(d);
    const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1));
    const half = (1.96 * sd) / Math.sqrt(d.length);
    const ci =
      r.k === BASELINE
        ? "baseline"
        : `${m.toFixed(3)} [${(m - half).toFixed(3)}, ${(m + half).toFixed(3)}]`;
    console.log(
      `| ${r.k} | ${r.mae.toFixed(2)} | ${r.early.toFixed(2)} | ${r.late.toFixed(2)} | ${ci} |`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
