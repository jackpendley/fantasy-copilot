// Walk-forward backtest of the per-game projection on the 2025-26 season (read-only; no ESPN
// writes). For every game a player played, each predictor sees only what was known before
// tip: his 2024-25 per-game average (the prior), his earlier 2025-26 games, and that game's
// closing line (a pregame number) with the league's average implied team total from earlier
// days. Scored with this league's current scoring.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-projection.ts
//   TEST_SEASON=2025 ... tests 2024-25 instead (prior 2023-24). Seasons are named by end year.
//
// Game logs and game lines (public ESPN data) are cached in data/local/backtest/ (gitignored).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fetchLeague, parseSettings } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import {
  fetchGameLog,
  fetchGameOdds,
  impliedTeamTotal,
  type GameLogEntry,
  type GameOdds,
} from "@fantasy-copilot/nba-data";
import { espnConfig } from "../lib/env";
import { etDate } from "../lib/nba/calendar";
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

/** The game being predicted: his team's implied points from the line, and the league's average. */
interface Next {
  teamTotal: number | null;
  leagueTotal: number | null;
}

/** A predictor: expected FP for the next game from the prior, the games so far and the line. */
type Predictor = (prior: number, games: Game[], next: Next) => number;

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
  (prior, games, next) => {
    const p = base(prior, games, next);
    if (games.length < window + 3) return p;
    const season = mean(games.map((g) => g.min));
    const recent = mean(games.slice(-window).map((g) => g.min));
    if (season <= 0) return p;
    const ratio = Math.min(1.4, Math.max(0.6, recent / season));
    return p * (1 + strength * (ratio - 1));
  };

/**
 * Game environment: scale by his team's implied points relative to the league average,
 * (team / league)^beta. More expected points means more shots, rebounds and assists to go
 * around. Unchanged when either number is missing.
 */
const gameEnvironment =
  (base: Predictor, beta: number): Predictor =>
  (prior, games, next) => {
    const p = base(prior, games, next);
    if (!next.teamTotal || !next.leagueTotal) return p;
    return p * Math.pow(next.teamTotal / next.leagueTotal, beta);
  };

async function gameLines(ids: number[], season: number): Promise<Map<number, GameOdds | null>> {
  const file = new URL(`odds-${season}.json`, CACHE);
  const cached: Record<string, GameOdds | null> = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const missing = ids.filter((id) => !(id in cached));
  if (missing.length) console.log(`fetching ${missing.length} game lines (cached after this run)…`);
  await inBatches(missing, 8, async (id) => {
    cached[id] = await fetchGameOdds(id).catch(() => null);
  });
  writeFileSync(file, JSON.stringify(cached));
  return new Map(Object.entries(cached).map(([k, v]) => [Number(k), v]));
}

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
    ...Object.fromEntries(
      [0.25, 0.5, 0.75, 1, 1.5].map((b) => [
        `blend 15 + minutes trend + game environment (beta ${b})`,
        gameEnvironment(minutesTrend(blend(15), 5, 0.5), b),
      ]),
    ),
  };
  // What ships today (BASELINE="blend PRIOR_GAMES=15" reproduces the first model card tables).
  const BASELINE = process.env.BASELINE || "blend 15 + minutes trend (5 g, 0.5)";

  // Game lines for every game in the test season, and the league's average implied team
  // total from the days before each game (point in time; none until 40 team-games are in).
  const seasonGames = new Map<number, string>();
  for (const { cur } of logs)
    for (const g of cur)
      if (g.part === "regular") seasonGames.set(g.gameId, etDate(new Date(g.date)));
  const lines = await gameLines([...seasonGames.keys()], TEST);
  const totalsByDay = new Map<string, number[]>();
  for (const [id, day] of seasonGames) {
    const o = lines.get(id);
    if (!o) continue;
    if (!totalsByDay.has(day)) totalsByDay.set(day, []);
    totalsByDay.get(day)!.push(impliedTeamTotal(o, true), impliedTeamTotal(o, false));
  }
  const leagueBefore = new Map<string, number | null>();
  {
    let sum = 0;
    let n = 0;
    for (const day of [...totalsByDay.keys()].sort()) {
      leagueBefore.set(day, n >= 40 ? sum / n : null);
      for (const t of totalsByDay.get(day)!) {
        sum += t;
        n++;
      }
    }
  }
  console.log(
    `game lines: ${[...lines.values()].filter(Boolean).length} of ${seasonGames.size} games`,
  );
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
      const odds = lines.get(g.gameId);
      const next: Next = {
        teamTotal: odds ? impliedTeamTotal(odds, g.home) : null,
        leagueTotal: leagueBefore.get(etDate(new Date(g.date))) ?? null,
      };
      for (const [k, pred] of Object.entries(predictors)) {
        const e = Math.abs(pred(prior, seen, next) - actual);
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
