// Teammate context (MODEL_CARD, teammate absences by impact, Nov 19): every player-game of a
// cached season (scripts/fetch-history.ts, or the box-score seasons of
// scripts/fetch-history-boxscores.ts), with today's projection as of that day, the
// regulars absent from it (each weighted by his share of the team's fantasy points), and the
// same for each of the player's earlier games. Read-only.
//
// Absent: a teammate with 5+ games this season before the game, his latest for this team,
// 10+ minutes a game over his last 10, who didn't play. A teammate whose next game is for
// another team was traded (in production the roster says so). His share: his FP/G over his
// last 10 games ÷ the team's FP per game over its last 10. All point in time, except that
// who sat tonight is read from the box score (in production, the injury report).

import { readdirSync, readFileSync } from "node:fs";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import {
  absencesByGame,
  CAP,
  contextFactor,
  FLOOR,
  REGULAR_MIN,
  type Absent,
  type Appearance,
} from "../lib/nba/context";
import { perGameProjection } from "../lib/nba/projection";

/** The 2017-26 logs; the box-score seasons are read from their own cache. */
const CACHE = new URL("../data/local/backtest/", import.meta.url);
/** A player-game is scored once he has this many games this season. */
const MIN_SO = 5;

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export type { Absent } from "../lib/nba/context";

export interface PlayerGame {
  season: number;
  player: number;
  group: string | null;
  /** The game: ESPN id, tip time (ms), opponent's abbreviation, and whether he was home. */
  gameId: number;
  t: number;
  opponent: string;
  home: boolean;
  /** Today's projection (FP/G) as of the game's day, and the fantasy points he scored. */
  base: number;
  fp: number;
  /** Teammates absent tonight. */
  absent: Absent[];
  /** The opponent's players absent tonight (the same rules, from its side). */
  oppAbsent: Absent[];
  /** His earlier games this season, each with the teammates absent from it. */
  past: { fp: number; min: number; absent: Absent[] }[];
  prior: { fp: number; min: number; gp: number } | null;
}

/** ESPN's default position id → group (guards, forwards, centers). */
const groupOf = (pos: number | undefined) =>
  pos == null ? null : pos <= 2 ? "G" : pos <= 4 ? "F" : "C";

/** A player as perGameProjection reads him: last season as the projection, these games. */
export function asPlayer(
  prior: PlayerGame["prior"],
  games: { fp: number; min: number }[],
): RosterPlayer {
  const sum = games.reduce((a, g) => a + g.fp, 0);
  return {
    id: 0,
    name: "",
    proTeamId: 0,
    proTeam: "",
    positions: [],
    slot: null,
    injuryStatus: "ACTIVE",
    percentOwned: 0,
    percentChange: 0,
    projection: prior
      ? { avg: prior.fp, total: prior.fp * prior.gp, stats: { MIN: prior.min } }
      : null,
    season: games.length
      ? { avg: sum / games.length, total: sum, stats: { MIN: mean(games.map((g) => g.min)) } }
      : null,
    last7: null,
    last15: null,
    last30: null,
    games: games.map((g, i) => ({ scoringPeriodId: i + 1, points: g.fp, line: { MIN: g.min } })),
  } as unknown as RosterPlayer;
}

interface G {
  side: string;
  game: number;
  opponent: string;
  home: boolean;
  t: number;
  fp: number;
  min: number;
}

/**
 * Every player-game of a season. `withPrior` (MODEL_CARD, last season's games, Nov 20): each
 * player's last-season games, with the team he played them for, are passed to the absence
 * rules, so his window may reach back into them (`lib/nba/context.ts`, `gamesBefore`).
 */
export function playerGames(
  season: number,
  scoring: ScoringMap,
  cache = CACHE,
  withPrior = false,
): PlayerGame[] {
  const fpOf = (g: GameLogEntry) => fantasyPoints(withDerived(g.line), scoring);
  const read = (f: string): GameLogEntry[] => JSON.parse(readFileSync(new URL(f, cache), "utf8"));
  const positions = new Map(
    Object.entries(
      JSON.parse(readFileSync(new URL(`positions-${season}.json`, cache), "utf8")) as Record<
        string,
        number
      >,
    ).map(([id, pos]) => [Number(id), pos]),
  );
  const files = new Set(readdirSync(cache).filter((f) => /^\d+-\d+\.json$/.test(f)));
  const ids = [...new Set([...files].map((f) => Number(f.split("-")[0])))].filter((id) =>
    files.has(`${id}-${season}.json`),
  );
  const logs = new Map<number, G[]>();
  const priors = new Map<number, NonNullable<PlayerGame["prior"]>>();
  // A side's team is what the other side lists as its opponent; its FP is its players' sum.
  const sideTeam = new Map<string, string>();
  const sideFp = new Map<string, number>();
  for (const id of ids) {
    const regular = (s: number) =>
      files.has(`${id}-${s}.json`)
        ? read(`${id}-${s}.json`).filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0)
        : [];
    const cur = regular(season);
    const prev = regular(season - 1);
    if (prev.length)
      priors.set(id, {
        fp: mean(prev.map(fpOf)),
        min: mean(prev.map((g) => g.line.MIN ?? 0)),
        gp: prev.length,
      });
    const gs = cur
      .map((g) => ({
        side: `${g.gameId}:${g.home ? "H" : "A"}`,
        game: g.gameId,
        opponent: g.opponent,
        home: g.home,
        t: Date.parse(g.date),
        fp: fpOf(g),
        min: g.line.MIN ?? 0,
      }))
      .sort((a, b) => a.t - b.t);
    for (const g of cur) sideTeam.set(`${g.gameId}:${g.home ? "A" : "H"}`, g.opponent);
    for (const g of gs) sideFp.set(g.side, (sideFp.get(g.side) ?? 0) + g.fp);
    if (gs.length) logs.set(id, gs);
  }
  // Last season's games of this season's players, each with his team then (what the other
  // side lists as its opponent, from every player's last-season log).
  let prior: Map<number, Appearance[]> | undefined;
  if (withPrior) {
    const prevTeam = new Map<string, string>();
    const prevLogs = new Map<number, GameLogEntry[]>();
    for (const f of files) {
      if (!f.endsWith(`-${season - 1}.json`)) continue;
      const gs = read(f).filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0);
      for (const g of gs) prevTeam.set(`${g.gameId}:${g.home ? "A" : "H"}`, g.opponent);
      const id = Number(f.split("-")[0]);
      if (logs.has(id)) prevLogs.set(id, gs);
    }
    prior = new Map(
      [...prevLogs].map(([id, gs]) => [
        id,
        gs
          .map((g) => {
            const side = `${g.gameId}:${g.home ? "H" : "A"}`;
            return {
              side,
              team: prevTeam.get(side),
              t: Date.parse(g.date),
              fp: fpOf(g),
              min: g.line.MIN ?? 0,
            };
          })
          .sort((a, b) => a.t - b.t),
      ]),
    );
  }
  // Who was absent from each team-game (lib/nba/context.ts, shared with production).
  const absentAt = absencesByGame(
    new Map(
      [...logs].map(([id, gs]) => [
        id,
        gs.map((g) => ({ side: g.side, team: sideTeam.get(g.side), t: g.t, fp: g.fp, min: g.min })),
      ]),
    ),
    (id) => groupOf(positions.get(id)),
    prior,
  );

  const rows: PlayerGame[] = [];
  for (const [p, gs] of logs) {
    const prior = priors.get(p) ?? null;
    for (let i = MIN_SO; i < gs.length; i++) {
      const g = gs[i]!;
      if (!sideTeam.get(g.side)) continue;
      const so = gs.slice(0, i);
      const base = perGameProjection(asPlayer(prior, so)).fppg;
      if (!(base > 0)) continue;
      rows.push({
        season,
        player: p,
        group: groupOf(positions.get(p)),
        gameId: g.game,
        t: g.t,
        opponent: g.opponent,
        home: g.home,
        base,
        fp: g.fp,
        absent: absentAt.get(g.side) ?? [],
        oppAbsent: absentAt.get(`${g.game}:${g.home ? "A" : "H"}`) ?? [],
        past: so.map((x) => ({ fp: x.fp, min: x.min, absent: absentAt.get(x.side) ?? [] })),
        prior,
      });
    }
  }
  return rows;
}

// The model (MODEL_CARD, teammate absences by impact), as tested on Nov 19.

export { REGULAR_MIN } from "../lib/nba/context";
/** Described: a star has this share or more. */
export const STAR = 0.18;

/** The context model: full-strength games (each ÷ its factor), then × tonight's factor. */
export function predict(r: PlayerGame) {
  const full = r.past.map((g) => {
    const x = contextFactor(g.absent, r.group);
    return { fp: g.fp / x, min: g.min / x };
  });
  return perGameProjection(asPlayer(r.prior, full)).fppg * contextFactor(r.absent, r.group);
}

/**
 * Opponents' absences (MODEL_CARD, Nov 20): 1 + k × min(cap, Σ over the opponent's regulars
 * out of max(0, share − floor) × (`same` in his position group, else 1)). Its k may be
 * negative (a missing star can slow the game down).
 */
export function opponentFactor(
  absent: readonly Absent[],
  group: string | null,
  k: number,
  same: number,
) {
  const sum = absent.reduce(
    (t, a) =>
      t +
      (a.min10 >= REGULAR_MIN ? Math.max(0, a.share - FLOOR) * (a.group === group ? same : 1) : 0),
    0,
  );
  return 1 + k * Math.min(CAP, sum);
}

/** Mean of per-player-season mean differences, with a normal 95% interval. */
export function judge(
  rows: PlayerGame[],
  pred: Map<PlayerGame, number>,
  d: (p: number, r: PlayerGame) => number,
) {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.season}:${r.player}`;
    by.set(k, [...(by.get(k) ?? []), d(pred.get(r)!, r)]);
  }
  const per = [...by.values()].map(mean);
  const m = mean(per);
  const half = (1.96 * Math.sqrt(mean(per.map((x) => (x - m) ** 2)))) / Math.sqrt(per.length);
  return { n: rows.length, players: per.length, mean: m, lo: m - half, hi: m + half };
}

export const starOut = (r: PlayerGame, lo: number, hi: number) =>
  r.absent.some((a) => a.min10 >= REGULAR_MIN && a.share >= STAR && a.idx >= lo && a.idx <= hi);
/** A star missed 3+ of his last 10 games and plays tonight. */
export const starBack = (r: PlayerGame) =>
  r.past.slice(-10).filter((g) => g.absent.some((a) => a.min10 >= REGULAR_MIN && a.share >= STAR))
    .length >= 3 && !starOut(r, 1, Infinity);
