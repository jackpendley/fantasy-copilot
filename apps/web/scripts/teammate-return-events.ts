// Teammate-return events from cached past seasons (scripts/fetch-history.ts), shared by tests 2
// and 3 (MODEL_CARD): a regular comes back from 5+ missed team games; each teammate's projection
// as of that day by today's rule and by the reverting candidates, and his rest-of-season FP/G.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { perGameProjection } from "../lib/nba/projection";

const CACHE = new URL("../data/local/backtest/", import.meta.url);
const MIN_MISSED = 5;
const REGULAR_MIN = 20;
/** B reverts after this many team games. */
const FIRST = 10;
/** The rest of the season must hold at least this many of his games. */
const REST_MIN = 10;
const SAME_SHIFT = 4;
const BOOT = 4000;
export const CANDIDATES = ["A", "B", "C"] as const;
export type Candidate = (typeof CANDIDATES)[number];

interface G {
  side: string;
  game: number;
  t: number;
  fp: number;
  min: number;
  /** Rebounds plus blocks (a big's role, by stats rather than ESPN's label). */
  rb: number;
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** ESPN's default position id → group (guards, forwards, centers). */
const groupOf = (pos: number | undefined) =>
  pos == null ? null : pos <= 2 ? "G" : pos <= 4 ? "F" : "C";

/** A player as perGameProjection reads him: last season as the projection, these games. */
function asPlayer(prior: { fp: number; min: number; gp: number } | null, games: G[]): RosterPlayer {
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

/** A tiny seeded generator (reproducible bootstrap). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

export interface Row {
  season: number;
  player: number;
  base: number;
  A: number;
  B: number;
  C: number;
  actual: number;
  /** His minutes during the absence minus before it. */
  minShift: number;
  /** P's position group, and whether it's T's. */
  group: string | null;
  /** Same group as T, and minutes up ≥ 4 (test 2's set 2). */
  same: boolean;
  /** Same group as T, whatever his minutes did. */
  sameGroup: boolean;
  /** The return game's time. */
  at: number;
  /** Described, not used by any rule: his FP/G and minutes before the absence, during it, and after the return; T's FP/G over his last 10 games before it. */
  fpBefore: number;
  fpDuring: number;
  minBefore: number;
  minDuring: number;
  minAfter: number;
  tFp: number;
  /**
   * Described (test 5's exploration): the returning player, his group, both players' eligible
   * positions that season (ESPN slot ids 0-4: PG, SG, SF, PF, C; empty if unknown), and rebounds
   * plus blocks per 36 minutes (P over his games before the return, T over his last 10).
   */
  teammate: number;
  tGroup: string | null;
  pElig: number[];
  tElig: number[];
  pRb36: number;
  tRb36: number;
}

export function analyze(season: number, scoring: ScoringMap): Row[] {
  const fp = (g: GameLogEntry) => fantasyPoints(withDerived(g.line), scoring);
  const read = (file: string): GameLogEntry[] =>
    JSON.parse(readFileSync(new URL(file, CACHE), "utf8"));
  const positions = new Map(
    Object.entries(
      JSON.parse(readFileSync(new URL(`positions-${season}.json`, CACHE), "utf8")) as Record<
        string,
        number
      >,
    ).map(([id, pos]) => [Number(id), pos]),
  );
  const eligibleFile = new URL(`eligible-${season}.json`, CACHE);
  const eligible = new Map(
    Object.entries(
      existsSync(eligibleFile)
        ? (JSON.parse(readFileSync(eligibleFile, "utf8")) as Record<string, number[]>)
        : {},
    ).map(([id, slots]) => [Number(id), slots]),
  );
  const rb36 = (gs: G[]) => {
    const min = gs.reduce((a, g) => a + g.min, 0);
    return min ? (36 * gs.reduce((a, g) => a + g.rb, 0)) / min : NaN;
  };
  const files = readdirSync(CACHE).filter((f) => /^\d+-\d+\.json$/.test(f));
  const ids = [...new Set(files.map((f) => Number(f.split("-")[0])))];
  const logs = new Map<number, G[]>();
  const priors = new Map<number, { fp: number; min: number; gp: number }>();
  // The two sides of each game: a side's team is what the other side lists as its opponent.
  const sideTeam = new Map<string, string>();
  for (const id of ids) {
    const regular = (s: number) =>
      files.includes(`${id}-${s}.json`)
        ? read(`${id}-${s}.json`).filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0)
        : [];
    const cur = regular(season);
    const prev = regular(season - 1);
    if (prev.length)
      priors.set(id, {
        fp: mean(prev.map(fp)),
        min: mean(prev.map((g) => g.line.MIN ?? 0)),
        gp: prev.length,
      });
    const gs = cur
      .map((g) => ({
        side: `${g.gameId}:${g.home ? "H" : "A"}`,
        game: g.gameId,
        t: Date.parse(g.date),
        fp: fp(g),
        min: g.line.MIN ?? 0,
        rb: (g.line.REB ?? 0) + (g.line.BLK ?? 0),
      }))
      .sort((a, b) => a.t - b.t);
    for (const g of cur) sideTeam.set(`${g.gameId}:${g.home ? "A" : "H"}`, g.opponent);
    if (gs.length) logs.set(id, gs);
  }
  // Each team's games (the sides its players played), in order.
  const teamGames = new Map<string, { side: string; t: number }[]>();
  const seen = new Set<string>();
  for (const gs of logs.values())
    for (const g of gs) {
      const team = sideTeam.get(g.side);
      if (!team || seen.has(g.side)) continue;
      seen.add(g.side);
      teamGames.set(team, [...(teamGames.get(team) ?? []), { side: g.side, t: g.t }]);
    }
  for (const list of teamGames.values()) list.sort((a, b) => a.t - b.t);
  const played = new Map([...logs].map(([id, gs]) => [id, new Set(gs.map((g) => g.side))]));
  const teamAt = (id: number, side: string) =>
    played.get(id)?.has(side) ? sideTeam.get(side) : undefined;

  const rows: Row[] = [];
  for (const [t, tg] of logs) {
    for (let i = 0; i < tg.length - 1; i++) {
      const last = tg[i]!;
      const back = tg[i + 1]!;
      const team = sideTeam.get(last.side);
      if (!team || sideTeam.get(back.side) !== team) continue; // traded, or unknown
      const before = tg.slice(Math.max(0, i - 9), i + 1);
      if (mean(before.map((g) => g.min)) < REGULAR_MIN) continue;
      const schedule = teamGames.get(team)!;
      const missed = schedule.filter((g) => g.t > last.t && g.t < back.t);
      if (missed.length < MIN_MISSED) continue;
      const missedSides = new Set(missed.map((g) => g.side));
      // The team's games from the return on (known on the day): B's weights.
      const teamLeft = schedule.filter((g) => g.t >= back.t).length;
      // Each teammate on the team at the return game.
      for (const [p, pg] of logs) {
        if (p === t || teamAt(p, back.side) !== team) continue;
        const prior = priors.get(p) ?? null;
        const so = pg.filter((g) => g.t < back.t);
        const during = so.filter((g) => missedSides.has(g.side));
        const rest = pg.filter((g) => g.t >= back.t);
        if (so.length < 10 || during.length < 3 || rest.length < REST_MIN) continue;
        const withT = so.filter((g) => played.get(t)!.has(g.side));
        const beforeAbsence = so.filter((g) => g.t <= last.t);
        const base = perGameProjection(asPlayer(prior, so)).fppg;
        const A = perGameProjection(asPlayer(prior, withT)).fppg;
        const first = Math.min(FIRST, teamLeft);
        const minShift =
          mean(during.map((g) => g.min)) -
          (beforeAbsence.length ? mean(beforeAbsence.map((g) => g.min)) : 0);
        const group = groupOf(positions.get(p));
        rows.push({
          season,
          player: p,
          base,
          A,
          B: (first * base + (teamLeft - first) * A) / teamLeft,
          C: (base + A) / 2,
          actual: mean(rest.map((g) => g.fp)),
          minShift,
          group,
          same: group != null && group === groupOf(positions.get(t)) && minShift >= SAME_SHIFT,
          sameGroup: group != null && group === groupOf(positions.get(t)),
          at: back.t,
          fpBefore: beforeAbsence.length ? mean(beforeAbsence.map((g) => g.fp)) : NaN,
          fpDuring: mean(during.map((g) => g.fp)),
          minBefore: beforeAbsence.length ? mean(beforeAbsence.map((g) => g.min)) : NaN,
          minDuring: mean(during.map((g) => g.min)),
          minAfter: mean(rest.map((g) => g.min)),
          tFp: mean(before.map((g) => g.fp)),
          teammate: t,
          tGroup: groupOf(positions.get(t)),
          pElig: eligible.get(p) ?? [],
          tElig: eligible.get(t) ?? [],
          pRb36: rb36(so),
          tRb36: rb36(before),
        });
      }
    }
  }
  return rows;
}

/** Mean (candidate error − today's error), with a (1 − alpha) bootstrap interval clustered by player. */
export function judge(rows: Row[], k: Candidate, alpha: number, seed: number) {
  const diff = (r: Row) => Math.abs(r[k] - r.actual) - Math.abs(r.base - r.actual);
  const byPlayer = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.season}:${r.player}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), diff(r)]);
  }
  const clusters = [...byPlayer.values()];
  const draw = rng(seed);
  const means: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[Math.floor(draw() * clusters.length)]!;
      for (const x of c) s += x;
      n += c.length;
    }
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return {
    n: rows.length,
    players: clusters.length,
    base: mean(rows.map((r) => Math.abs(r.base - r.actual))),
    cand: mean(rows.map((r) => Math.abs(r[k] - r.actual))),
    diff: mean(rows.map(diff)),
    lo: means[Math.floor((alpha / 2) * BOOT)]!,
    hi: means[Math.floor((1 - alpha / 2) * BOOT)]!,
  };
}
