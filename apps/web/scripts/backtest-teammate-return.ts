// Projections after a teammate returns (MODEL_CARD pre-registration 2026-11-16): as of the day a
// regular teammate comes back from 5+ missed games, does projecting each affected player from
// only the games that teammate played predict his next 10 games better than today's projection?
// Both use the shipped perGameProjection (lib/nba/projection.ts) with last season as the prior.
// Read-only: the cached public ESPN game logs in data/local/backtest/ (gitignored) and the
// league's scoring settings.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-teammate-return.ts
//   DRY=1 ...   event counts only (checks the harness without looking at outcomes)

import { readdirSync, readFileSync } from "node:fs";
import { fetchLeague, parseSettings, type RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { espnConfig } from "../lib/env";
import { perGameProjection } from "../lib/nba/projection";

const CACHE = new URL("../data/local/backtest/", import.meta.url);
const SEASONS = [2026, 2025]; // 2025-26 and 2024-25, named by end year; priors one year earlier
const MIN_MISSED = 5;
const REGULAR_MIN = 20;
const NEXT = 10;
const NEXT_MIN = 5;
const BOOT = 2000;

interface G {
  side: string;
  game: number;
  t: number;
  fp: number;
  min: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

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
  cand: number;
  actual: number;
  /** His minutes during the absence minus before it. */
  minShift: number;
}

function analyze(season: number, scoring: ScoringMap): Row[] {
  const fp = (g: GameLogEntry) => fantasyPoints(withDerived(g.line), scoring);
  const read = (file: string): GameLogEntry[] =>
    JSON.parse(readFileSync(new URL(file, CACHE), "utf8"));
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
      // Each teammate on the team at the return game.
      for (const [p, pg] of logs) {
        if (p === t || teamAt(p, back.side) !== team) continue;
        const prior = priors.get(p) ?? null;
        const so = pg.filter((g) => g.t < back.t);
        const during = so.filter((g) => missedSides.has(g.side));
        const next = pg.filter((g) => g.t >= back.t).slice(0, NEXT);
        if (so.length < 10 || during.length < 3 || next.length < NEXT_MIN) continue;
        const withT = so.filter((g) => played.get(t)!.has(g.side));
        const beforeAbsence = so.filter((g) => g.t <= last.t);
        rows.push({
          season,
          player: p,
          base: perGameProjection(asPlayer(prior, so)).fppg,
          cand: perGameProjection(asPlayer(prior, withT)).fppg,
          actual: mean(next.map((g) => g.fp)),
          minShift:
            mean(during.map((g) => g.min)) -
            (beforeAbsence.length ? mean(beforeAbsence.map((g) => g.min)) : 0),
        });
      }
    }
  }
  return rows;
}

/** Mean (candidate error - baseline error), with a 95% bootstrap interval clustered by player. */
function judge(rows: Row[]) {
  const diff = (r: Row) => Math.abs(r.cand - r.actual) - Math.abs(r.base - r.actual);
  const byPlayer = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.season}:${r.player}`;
    byPlayer.set(k, [...(byPlayer.get(k) ?? []), diff(r)]);
  }
  const clusters = [...byPlayer.values()];
  const draw = rng(20261116);
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
    cand: mean(rows.map((r) => Math.abs(r.cand - r.actual))),
    diff: mean(rows.map(diff)),
    lo: means[Math.floor(0.025 * BOOT)]!,
    hi: means[Math.floor(0.975 * BOOT)]!,
  };
}

async function main() {
  const scoring = parseSettings(await fetchLeague(espnConfig(), ["mSettings"])).scoring;
  const all = SEASONS.flatMap((s) => analyze(s, scoring));
  // EXPLORE=1 (after the one evaluation, not a test): today's projection's signed error by how
  // much his minutes moved while the teammate was out.
  if (process.env.EXPLORE) {
    const buckets: [string, (r: Row) => boolean][] = [
      ["minutes up ≥ 6", (r) => r.minShift >= 6],
      ["minutes up 3-6", (r) => r.minShift >= 3 && r.minShift < 6],
      ["within ±3", (r) => Math.abs(r.minShift) < 3],
      ["minutes down ≥ 3", (r) => r.minShift <= -3],
    ];
    console.log("| Minutes while he was out | n | today − actual | candidate − actual |");
    console.log("|---|---|---|---|");
    for (const [label, f] of buckets) {
      const rows = all.filter(f);
      const m = (k: "base" | "cand") => mean(rows.map((r) => r[k] - r.actual));
      console.log(
        `| ${label} | ${rows.length} | ${m("base").toFixed(2)} | ${m("cand").toFixed(2)} |`,
      );
    }
    return;
  }
  // DRY=1: check the harness without looking at any outcome (event counts and inputs only).
  if (process.env.DRY) {
    for (const s of SEASONS) {
      const rows = all.filter((r) => r.season === s);
      const shifted = rows.filter((r) => Math.abs(r.minShift) >= 4).length;
      const same = rows.filter((r) => Math.abs(r.cand - r.base) < 0.05).length;
      console.log(
        `${s}: ${rows.length} player-events, ${new Set(rows.map((r) => r.player)).size} players, ` +
          `${shifted} with minutes moved ≥ 4, ${same} where the candidate equals today's`,
      );
    }
    return;
  }
  const line = (label: string, rows: Row[]) => {
    if (!rows.length) return console.log(`| ${label} | 0 | | | | |`);
    const j = judge(rows);
    console.log(
      `| ${label} | ${j.n} (${j.players} players) | ${j.base.toFixed(2)} | ${j.cand.toFixed(2)} | ${j.diff >= 0 ? "+" : ""}${j.diff.toFixed(3)} | [${j.lo.toFixed(3)}, ${j.hi.toFixed(3)}] |`,
    );
  };
  console.log(
    "| Events | n | MAE today | MAE candidate | Candidate − today | 95% CI (by player) |",
  );
  console.log("|---|---|---|---|---|---|");
  line("**Pooled (the test)**", all);
  for (const s of SEASONS)
    line(
      `${s - 1}-${String(s).slice(2)}`,
      all.filter((r) => r.season === s),
    );
  line(
    "Minutes moved ≥ 4 during the absence",
    all.filter((r) => Math.abs(r.minShift) >= 4),
  );
  const pooled = judge(all);
  console.log(`\nShips: ${pooled.hi < 0 ? "yes (interval below 0)" : "no"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
