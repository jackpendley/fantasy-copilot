// Teammate returns, test 2 (MODEL_CARD pre-registration 2026-11-16): as of the day a regular
// teammate comes back from 5+ missed games, does reverting a fill-in's projection (fully, after
// 10 games, or halfway) predict his rest-of-season FP/G better than today's? All affected
// teammates, and same-position backups whose minutes rose. Events exactly as test 1
// (scripts/backtest-teammate-return.ts); seasons 2021-22 to 2023-24, unseen for this question.
// Read-only: the cached public ESPN game logs and positions (scripts/fetch-history.ts) and the
// league's scoring settings.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-teammate-return-2.ts
//   DRY=1 ...       event counts only (checks the harness without looking at outcomes)
//   EXPLORE=1 ...   after the evaluation: backup centers' signed errors (not a test)

import { readdirSync, readFileSync } from "node:fs";
import { fetchLeague, parseSettings, type RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { espnConfig } from "../lib/env";
import { perGameProjection } from "../lib/nba/projection";

const CACHE = new URL("../data/local/backtest/", import.meta.url);
const SEASONS = [2024, 2023, 2022]; // 2023-24, 2022-23, 2021-22, by end year; priors one year earlier
const MIN_MISSED = 5;
const REGULAR_MIN = 20;
/** B reverts after this many team games. */
const FIRST = 10;
/** The rest of the season must hold at least this many of his games. */
const REST_MIN = 10;
const SAME_SHIFT = 4;
const BOOT = 4000;
/** Six comparisons: Bonferroni for 95% overall. */
const ALPHA = 0.05 / 6;
const CANDIDATES = ["A", "B", "C"] as const;
type Candidate = (typeof CANDIDATES)[number];

interface G {
  side: string;
  game: number;
  t: number;
  fp: number;
  min: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

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

interface Row {
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
  same: boolean;
}

function analyze(season: number, scoring: ScoringMap): Row[] {
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
        });
      }
    }
  }
  return rows;
}

/** Mean (candidate error − today's error), with a bootstrap interval clustered by player. */
function judge(rows: Row[], k: Candidate) {
  const diff = (r: Row) => Math.abs(r[k] - r.actual) - Math.abs(r.base - r.actual);
  const byPlayer = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.season}:${r.player}`;
    byPlayer.set(key, [...(byPlayer.get(key) ?? []), diff(r)]);
  }
  const clusters = [...byPlayer.values()];
  const draw = rng(20261117);
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
    lo: means[Math.floor((ALPHA / 2) * BOOT)]!,
    hi: means[Math.floor((1 - ALPHA / 2) * BOOT)]!,
  };
}

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const all = SEASONS.flatMap((s) => analyze(s, scoring));
  const sets: [string, Row[]][] = [
    ["1. All affected teammates", all],
    ["2. Same-position backups, minutes up ≥ 4", all.filter((r) => r.same)],
  ];
  // DRY=1: check the harness without looking at any outcome (event counts and inputs only).
  if (process.env.DRY) {
    for (const s of SEASONS) {
      const rows = all.filter((r) => r.season === s);
      console.log(
        `${s - 1}-${String(s).slice(2)}: ${rows.length} player-events, ` +
          `${new Set(rows.map((r) => r.player)).size} players, ` +
          `${rows.filter((r) => r.same).length} same-position backups, ` +
          `${rows.filter((r) => r.group == null).length} without a position`,
      );
    }
    return;
  }
  // EXPLORE=1 (after the one evaluation, not a test): backup centers whose minutes rose ≥ 6
  // (Paul Reed's case), each rule's signed error.
  if (process.env.EXPLORE) {
    const rows = all.filter((r) => r.same && r.group === "C" && r.minShift >= 6);
    const m = (k: "base" | Candidate) => mean(rows.map((r) => r[k] - r.actual)).toFixed(2);
    console.log(`Backup centers, minutes up ≥ 6: n ${rows.length}`);
    console.log(`today − actual ${m("base")} · A ${m("A")} · B ${m("B")} · C ${m("C")}`);
    return;
  }
  console.log(
    "| Set | Candidate | n | MAE today | MAE candidate | Candidate − today | 99.17% CI (by player) |",
  );
  console.log("|---|---|---|---|---|---|---|");
  const passed: string[] = [];
  for (const [label, rows] of sets)
    for (const k of CANDIDATES) {
      const j = judge(rows, k);
      if (j.hi < 0) passed.push(`${label} ${k}`);
      console.log(
        `| ${label} | ${k} | ${j.n} (${j.players} players) | ${j.base.toFixed(2)} | ${j.cand.toFixed(2)} | ${j.diff >= 0 ? "+" : ""}${j.diff.toFixed(3)} | [${j.lo.toFixed(3)}, ${j.hi.toFixed(3)}] |`,
      );
    }
  console.log(`\nPassed: ${passed.length ? passed.join("; ") : "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
