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
  /** Minutes his absent regular teammates usually play (point in time; 0 when all are in). */
  vacated: number;
  /** The same, counting only absent teammates who share a position with him. */
  vacatedSamePosition: number;
  /** His prior-season minutes per game and fantasy points per minute. */
  priorMin: number;
  priorRate: number;
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

/**
 * Minutes x rate (MODEL_CARD pre-registration 2026-10-29): minutes blended fast toward this
 * season (kMin prior games), fantasy points per minute slowly (kRate prior games).
 */
const minutesRate =
  (kMin: number, kRate: number): Predictor =>
  (prior, games, next) => {
    if (!games.length || !next.priorMin) return prior;
    const n = games.length;
    const min = (n * mean(games.map((g) => g.min)) + kMin * next.priorMin) / (n + kMin);
    const curMin = games.reduce((a, g) => a + g.min, 0);
    const curRate = curMin ? games.reduce((a, g) => a + g.fp, 0) / curMin : next.priorRate;
    const rate = (n * curRate + kRate * next.priorRate) / (n + kRate);
    return min * rate;
  };

/**
 * Minutes x rate with absent teammates' minutes (pre-registration 2026-10-29, family A): his
 * expected minutes grow by kSame x the minutes absent same-position regulars usually play,
 * plus kOther x the rest, capped at 40. His per-minute rate is unchanged.
 */
const minutesRateAbsences =
  (kMin: number, kRate: number, kSame: number, kOther: number): Predictor =>
  (prior, games, next) => {
    const base = minutesRate(kMin, kRate)(prior, games, next);
    if (!games.length || !next.priorMin || !next.vacated) return base;
    const n = games.length;
    const min = (n * mean(games.map((g) => g.min)) + kMin * next.priorMin) / (n + kMin);
    if (!min) return base;
    const extra =
      kSame * next.vacatedSamePosition + kOther * (next.vacated - next.vacatedSamePosition);
    return base * (Math.min(40, min + extra) / min);
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

/**
 * Teammate role boost: more minutes and shots to go around when regulars sit, scaled by the
 * minutes vacated (out of 240 a game), optionally by his own role.
 */
const roleBoost =
  (base: Predictor, k: number, byRole: boolean, samePosition = false): Predictor =>
  (prior, games, next) => {
    const p = base(prior, games, next);
    const vacated = samePosition ? next.vacatedSamePosition : next.vacated;
    if (!vacated) return p;
    const role = byRole && games.length ? mean(games.slice(-10).map((g) => g.min)) / 30 : 1;
    return p * (1 + k * (vacated / 240) * role);
  };

const DAY_MS = 86_400_000;

/** Family C (pre-registered 2026-10-29): generic prior for players ESPN didn't project. */
const UNPROJECTED_FPPG = 15;
const UNPROJECTED_MIN = 22.8;
const C_RATE_PRIORS = [5, 15];

/** Family E: the counting stats with their own opponent factor, and the k grid. */
const COUNTS = ["FGM", "FGA", "FTM", "FTA", "3PM", "REB", "AST", "STL", "BLK", "TO"];
const E_KS = [100, 200, 400];

/** Fantasy value of one more of each count (a make is also an attempt, so not a miss). */
function unitValues(s: ScoringMap): Record<string, number> {
  const w = (k: string) => s[k] ?? 0;
  return {
    FGM: w("FGM") - w("FGMI") + 2 * w("PTS"),
    FGA: w("FGMI"),
    FTM: w("FTM") - w("FTMI") + w("PTS"),
    FTA: w("FTMI"),
    "3PM": w("3PM") + w("PTS"),
    REB: w("REB"),
    AST: w("AST"),
    STL: w("STL"),
    BLK: w("BLK"),
    TO: w("TO"),
  };
}

/** Mean of per-player differences with a 95% interval ("" for the baseline row). */
function ci(d: number[]): string {
  if (d.length < 2) return "baseline";
  const m = mean(d);
  const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1));
  const half = (1.96 * sd) / Math.sqrt(d.length);
  return `${m.toFixed(3)} [${(m - half).toFixed(3)}, ${(m + half).toFixed(3)}]`;
}

/**
 * For every player-game in the pool: minutes vacated by regular teammates who didn't play.
 * A regular has averaged 20+ minutes over his last 10 games, the last of them for this team
 * within 10 days (point in time). A game's teams come from the opponents its players faced.
 */
function vacatedMinutes(
  players: { id: number; games: GameLogEntry[] }[],
  /** Only count absent teammates for whom this returns true (e.g. shares a position). */
  counts: (playerId: number, absentId: number) => boolean = () => true,
): Map<string, number> {
  const opponents = new Map<number, Set<string>>();
  for (const p of players)
    for (const g of p.games) {
      if (!opponents.has(g.gameId)) opponents.set(g.gameId, new Set());
      opponents.get(g.gameId)!.add(g.opponent);
    }
  const teamOf = (g: GameLogEntry) => {
    const s = opponents.get(g.gameId);
    return s && s.size === 2 ? ([...s].find((t) => t !== g.opponent) ?? null) : null;
  };
  const hist = players.map((p) => ({
    id: p.id,
    games: p.games
      .filter((g) => (g.line.MIN ?? 0) > 0)
      .map((g) => ({
        gameId: g.gameId,
        t: Date.parse(g.date),
        team: teamOf(g),
        min: g.line.MIN ?? 0,
      }))
      .sort((a, b) => a.t - b.t),
  }));
  const present = new Map<string, { t: number; ids: Set<number> }>();
  for (const h of hist)
    for (const g of h.games) {
      if (!g.team) continue;
      const key = `${g.gameId}:${g.team}`;
      if (!present.has(key)) present.set(key, { t: g.t, ids: new Set() });
      present.get(key)!.ids.add(h.id);
    }
  const out = new Map<string, number>();
  for (const [key, { t, ids }] of present) {
    const [gameId, team] = key.split(":");
    const absent: { id: number; avg: number }[] = [];
    for (const h of hist) {
      if (ids.has(h.id)) continue;
      let i = -1;
      for (let j = h.games.length - 1; j >= 0; j--)
        if (h.games[j]!.t < t) {
          i = j;
          break;
        }
      if (i < 0) continue;
      const last = h.games[i]!;
      if (last.team !== team || t - last.t > 10 * DAY_MS) continue;
      const avg = mean(h.games.slice(Math.max(0, i - 9), i + 1).map((g) => g.min));
      if (avg >= 20) absent.push({ id: h.id, avg });
    }
    for (const id of ids)
      out.set(
        `${id}:${gameId}`,
        absent.filter((a) => counts(id, a.id)).reduce((s, a) => s + a.avg, 0),
      );
  }
  return out;
}

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
    // What ships today, plus the teammate role boost.
    "current model (+ game environment 0.75)": gameEnvironment(
      minutesTrend(blend(15), 5, 0.5),
      0.75,
    ),
    // Pre-registered 2026-10-29 (family A): absent teammates' minutes on the shipped model.
    ...Object.fromEntries(
      [0.1, 0.2, 0.3].flatMap((ks) =>
        [0, 0.05].map((ko) => [
          `A: absences kSame ${ks} kOther ${ko}`,
          gameEnvironment(minutesTrend(minutesRateAbsences(2, 15, ks, ko), 5, 0.5), 0.75),
        ]),
      ),
    ),
    // Pre-registered 2026-10-29: minutes x rate, then the shipped trend and environment.
    ...Object.fromEntries(
      [2, 4, 8].flatMap((km) =>
        [15, 30].map((kr) => [
          `minutes x rate (kMin ${km}, kRate ${kr})`,
          gameEnvironment(minutesTrend(minutesRate(km, kr), 5, 0.5), 0.75),
        ]),
      ),
    ),
    ...Object.fromEntries(
      [0.25, 0.5, 0.75, 1].flatMap((k) => [
        [
          `current + role boost (k ${k})`,
          roleBoost(gameEnvironment(minutesTrend(blend(15), 5, 0.5), 0.75), k, false),
        ],
        [
          `current + role boost by role (k ${k})`,
          roleBoost(gameEnvironment(minutesTrend(blend(15), 5, 0.5), 0.75), k, true),
        ],
        [
          `current + role boost, same position (k ${k})`,
          roleBoost(gameEnvironment(minutesTrend(blend(15), 5, 0.5), 0.75), k, false, true),
        ],
      ]),
    ),
  };
  // What ships today (BASELINE="blend PRIOR_GAMES=15" reproduces the first model card tables;
  // "blend 15 + minutes trend (5 g, 0.5)" the game-environment ones; "current model (+ game
  // environment 0.75)" the minutes x rate test).
  const BASELINE = process.env.BASELINE || "minutes x rate (kMin 2, kRate 15)";

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
  const playerGames = logs.map((l) => ({
    id: l.id,
    games: l.cur.filter((g) => g.part === "regular"),
  }));
  const vacated = vacatedMinutes(playerGames);
  // Positions from today's ESPN data (eligibility rarely changes year to year).
  const positions = new Map(
    [...league.teams.flatMap((t) => t.roster), ...fas.map((f) => f.player)].map((p) => [
      p.id,
      new Set(p.positions),
    ]),
  );
  const vacatedSame = vacatedMinutes(playerGames, (id, absent) =>
    [...(positions.get(id) ?? [])].some((pos) => positions.get(absent)?.has(pos)),
  );
  // Family B (opponent defense against each position) needs every game's baseline first.
  const firstPosition = new Map(
    [...league.teams.flatMap((t) => t.roster), ...fas.map((f) => f.player)].map((p) => [
      p.id,
      p.positions[0] ?? "?",
    ]),
  );
  const recs: {
    id: number;
    day: string;
    opp: string;
    pos: string;
    pred: number;
    actual: number;
    early: boolean;
    /** Family E: this game's counts, and his prior-season count of each stat per fantasy point. */
    line: Record<string, number>;
    perFp: Record<string, number>;
  }[] = [];
  /** Family C: players without a real prior, projected as ESPN-unprojected (fallback vs minutes). */
  const unprojected: {
    id: number;
    day: string;
    opp: string;
    pos: string;
    actual: number;
    base: number;
    cand: Record<number, number>;
  }[] = [];
  let unprojectedPlayers = 0;

  for (const { id, prev, cur } of logs) {
    const fp = (g: GameLogEntry) => fantasyPoints(withDerived(g.line), scoring);
    const prevGames = prev.filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0);
    const curGames = cur.filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0);
    if (prevGames.length < 20 && curGames.length >= 20) {
      // Family C (pre-registered 2026-10-29): no real prior, so projected as ESPN-unprojected.
      unprojectedPlayers++;
      const seenC: Game[] = [];
      for (const g of curGames) {
        const actual = fp(g);
        const odds = lines.get(g.gameId);
        const next: Next = {
          teamTotal: odds ? impliedTeamTotal(odds, g.home) : null,
          leagueTotal: leagueBefore.get(etDate(new Date(g.date))) ?? null,
          vacated: 0,
          vacatedSamePosition: 0,
          priorMin: UNPROJECTED_MIN,
          priorRate: UNPROJECTED_FPPG / UNPROJECTED_MIN,
        };
        const layers = (p: Predictor) => gameEnvironment(minutesTrend(p, 5, 0.5), 0.75);
        unprojected.push({
          id,
          day: etDate(new Date(g.date)),
          opp: g.opponent,
          pos: firstPosition.get(id) ?? "?",
          actual,
          base: layers(blend(15))(UNPROJECTED_FPPG, seenC, next),
          cand: Object.fromEntries(
            C_RATE_PRIORS.map((kr) => [
              kr,
              layers(minutesRate(2, kr))(UNPROJECTED_FPPG, seenC, next),
            ]),
          ),
        });
        seenC.push({ fp: actual, min: g.line.MIN ?? 0 });
      }
      continue;
    }
    // Point in time: a prior needs a real 2024-25 sample; the player needs a 2025-26 season.
    if (prevGames.length < 20 || curGames.length < 20) continue;
    players++;
    const prior = mean(prevGames.map(fp));
    const priorMin = mean(prevGames.map((g) => g.line.MIN ?? 0));
    const priorRate =
      prevGames.reduce((a, g) => a + fp(g), 0) /
      Math.max(
        1,
        prevGames.reduce((a, g) => a + (g.line.MIN ?? 0), 0),
      );
    const priorFp = mean(prevGames.map(fp));
    const perFp = Object.fromEntries(
      COUNTS.map((c) => [
        c,
        priorFp > 0 ? mean(prevGames.map((g) => g.line[c] ?? 0)) / priorFp : 0,
      ]),
    );
    const seen: Game[] = [];
    const mine: Record<string, number[]> = {};
    for (const k of Object.keys(predictors)) mine[k] = [];
    for (const g of curGames) {
      const actual = fp(g);
      const odds = lines.get(g.gameId);
      const next: Next = {
        teamTotal: odds ? impliedTeamTotal(odds, g.home) : null,
        leagueTotal: leagueBefore.get(etDate(new Date(g.date))) ?? null,
        vacated: vacated.get(`${id}:${g.gameId}`) ?? 0,
        vacatedSamePosition: vacatedSame.get(`${id}:${g.gameId}`) ?? 0,
        priorMin,
        priorRate,
      };
      recs.push({
        id,
        day: etDate(new Date(g.date)),
        opp: g.opponent,
        pos: firstPosition.get(id) ?? "?",
        pred: predictors[BASELINE]!(prior, seen, next),
        actual,
        early: seen.length < 20,
        line: g.line,
        perFp,
      });
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

  // Family B: f = (n r + k) / (n + k) from the opponent's earlier days against this position.
  {
    const ks = [100, 200, 400];
    const byPlayer = new Map<number, { base: number[]; cand: number[][] }>();
    const acc = new Map<string, { a: number; p: number; n: number }>();
    const days = [...new Set(recs.map((r) => r.day))].sort();
    const byDay = new Map<string, typeof recs>();
    for (const r of recs) {
      if (!byDay.has(r.day)) byDay.set(r.day, []);
      byDay.get(r.day)!.push(r);
    }
    for (const k of ks)
      err[`B: opponent defense by position k ${k}`] = { all: [], early: [], late: [] };
    // Family E: per stat, against the shipped B (k 200). Family C: on its own pool, both
    // predictions scaled by the shipped B factor as in production.
    const unit = unitValues(scoring);
    const accE = new Map<string, { a: number; e: number; n: number }>();
    const byPlayerE = new Map<number, { b200: number[]; cand: number[][] }>();
    const byPlayerC = new Map<number, { base: number[]; cand: number[][] }>();
    const unprojectedByDay = new Map<string, typeof unprojected>();
    for (const u of unprojected) {
      if (!unprojectedByDay.has(u.day)) unprojectedByDay.set(u.day, []);
      unprojectedByDay.get(u.day)!.push(u);
    }
    const factorB = (opp: string, pos: string) => {
      const s = acc.get(`${opp}|${pos}`);
      const n = s?.n ?? 0;
      const ratio = s && s.p > 0 ? s.a / s.p : 1;
      return (n * ratio + 200) / (n + 200);
    };
    for (const day of days) {
      for (const u of unprojectedByDay.get(day) ?? []) {
        const f = factorB(u.opp, u.pos);
        if (!byPlayerC.has(u.id))
          byPlayerC.set(u.id, { base: [], cand: C_RATE_PRIORS.map(() => []) });
        const bp = byPlayerC.get(u.id)!;
        bp.base.push(Math.abs(u.base * f - u.actual));
        C_RATE_PRIORS.forEach((kr, i) => bp.cand[i]!.push(Math.abs(u.cand[kr]! * f - u.actual)));
      }
      const today = byDay.get(day)!;
      for (const r of today) {
        const b200 = Math.abs(r.pred * factorB(r.opp, r.pos) - r.actual);
        if (!byPlayerE.has(r.id)) byPlayerE.set(r.id, { b200: [], cand: E_KS.map(() => []) });
        const be = byPlayerE.get(r.id)!;
        be.b200.push(b200);
        E_KS.forEach((k, i) => {
          let pred = r.pred;
          for (const c of COUNTS) {
            const expected = r.pred * r.perFp[c]!;
            const s = accE.get(`${r.opp}|${r.pos}|${c}`);
            const n = s?.n ?? 0;
            const ratio = s && s.e > 0 ? s.a / s.e : 1;
            pred += unit[c]! * expected * ((n * ratio + k) / (n + k) - 1);
          }
          be.cand[i]!.push(Math.abs(pred - r.actual));
        });
      }
      for (const r of today)
        for (const c of COUNTS) {
          const key = `${r.opp}|${r.pos}|${c}`;
          const s = accE.get(key) ?? { a: 0, e: 0, n: 0 };
          accE.set(key, { a: s.a + (r.line[c] ?? 0), e: s.e + r.pred * r.perFp[c]!, n: s.n + 1 });
        }
      for (const r of today) {
        const s = acc.get(`${r.opp}|${r.pos}`);
        const ratio = s && s.p > 0 ? s.a / s.p : 1;
        const n = s?.n ?? 0;
        if (!byPlayer.has(r.id)) byPlayer.set(r.id, { base: [], cand: ks.map(() => []) });
        const bp = byPlayer.get(r.id)!;
        bp.base.push(Math.abs(r.pred - r.actual));
        ks.forEach((k, i) => {
          const f = (n * ratio + k) / (n + k);
          const e = Math.abs(r.pred * f - r.actual);
          bp.cand[i]!.push(e);
          const bucket = err[`B: opponent defense by position k ${k}`]!;
          bucket.all.push(e);
          (r.early ? bucket.early : bucket.late).push(e);
        });
      }
      for (const r of today) {
        const key = `${r.opp}|${r.pos}`;
        const s = acc.get(key) ?? { a: 0, p: 0, n: 0 };
        acc.set(key, { a: s.a + r.actual, p: s.p + r.pred, n: s.n + 1 });
      }
    }
    ks.forEach((k, i) => {
      perPlayer[`B: opponent defense by position k ${k}`] = [...byPlayer.values()].map(
        (b) => mean(b.cand[i]!) - mean(b.base),
      );
    });

    const report = (title: string, rows: [string, number, number[]][]) => {
      console.log(`\n${title}\n`);
      console.log("| Predictor | MAE | vs baseline (95% CI, by player) |\n|---|---:|---|");
      for (const [name, mae, d] of rows) console.log(`| ${name} | ${mae.toFixed(4)} | ${ci(d)} |`);
    };
    const all = <T>(m: Map<number, T>, f: (t: T) => number[]) => [...m.values()].flatMap(f);
    report(`E: opponent defense per stat vs shipped B k 200 (${byPlayerE.size} players)`, [
      ["B k 200 (shipped)", mean(all(byPlayerE, (b) => b.b200)), []],
      ...E_KS.map(
        (k, i) =>
          [
            `E: per stat k ${k}`,
            mean(all(byPlayerE, (b) => b.cand[i]!)),
            [...byPlayerE.values()].map((b) => mean(b.cand[i]!) - mean(b.b200)),
          ] as [string, number, number[]],
      ),
    ]);
    report(`C: unprojected players (${unprojectedPlayers} players, ${unprojected.length} games)`, [
      [
        "fallback: blend toward 15.0 at 15 games (shipped)",
        mean(all(byPlayerC, (b) => b.base)),
        [],
      ],
      ...C_RATE_PRIORS.map(
        (kr, i) =>
          [
            `C: minutes x rate (M0 ${UNPROJECTED_MIN}, kMin 2, kRate ${kr})`,
            mean(all(byPlayerC, (b) => b.cand[i]!)),
            [...byPlayerC.values()].map((b) => mean(b.cand[i]!) - mean(b.base)),
          ] as [string, number, number[]],
      ),
    ]);
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
