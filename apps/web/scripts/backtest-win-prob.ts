// Win probability, candidate C vs the current model, on this league's 2025-26 season, rebuilt
// each morning from that day's rosters (read-only; ESPN only). Pre-registered in
// docs/MODEL_CARD.md ("Weekly win probability", Pre-registration 3b).
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-win-prob.ts
//
// ESPN responses and game logs are cached in data/local/ (gitignored: they hold other managers'
// rosters).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  fetchLeague,
  fetchProSchedule,
  parseMatchups,
  parseProSchedule,
  parseSettings,
  parseTeams,
  type ProGame,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import {
  fantasyPoints,
  optimizeLineup,
  withDerived,
  type Position,
  type ScoringMap,
} from "@fantasy-copilot/fantasy-core";
import { fetchGameLog, type GameLogEntry } from "@fantasy-copilot/nba-data";
import { espnConfig } from "../lib/env";
import { fitStartSd } from "./fit-start-sd";

const SEASON = 2026; // 2025-26, named by its end year
const PRIOR = 2025;
const LAST_N = 20;
const CURRENT_CV = 0.14;
const SPACING_MS = 1000;

const LOCAL = new URL("../data/local/", import.meta.url);
const ROSTERS = new URL("winprob-2026/", LOCAL);
const LOGS = new URL("backtest/", LOCAL);
mkdirSync(ROSTERS, { recursive: true });
mkdirSync(LOGS, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cachedJson(file: URL, load: () => Promise<unknown>): Promise<unknown> {
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const data = await load();
  writeFileSync(file, JSON.stringify(data));
  await sleep(SPACING_MS);
  return data;
}

async function gameLog(id: number, season: number): Promise<GameLogEntry[]> {
  const log = await cachedJson(new URL(`${id}-${season}.json`, LOGS), () =>
    fetchGameLog(id, season).catch(() => []),
  );
  return Array.isArray(log) ? (log as GameLogEntry[]) : [];
}

function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

interface State {
  week: number;
  home: number;
  daysLeft: number;
  mean: number;
  eHome: number;
  eAway: number;
  vHome: number;
  vAway: number;
  won: boolean;
}

async function main() {
  const cfg = { ...espnConfig(), season: SEASON };
  const raw = await fetchLeague(cfg, ["mMatchupScore", "mSettings"]);
  const settings = parseSettings(raw);
  const scoring: ScoringMap = settings.scoring;
  const games: ProGame[] = parseProSchedule(await fetchProSchedule(SEASON));
  const matchups = parseMatchups(raw).filter(
    (m) => m.period <= settings.regularSeasonWeeks && m.awayTeamId != null,
  );
  const sd = fitStartSd(scoring, [PRIOR]);
  console.log(
    `per-start SD (2024-25 games only): ${sd.a.toFixed(2)} + ${sd.b.toFixed(3)} x projection (${sd.games} games)`,
  );
  const startVar = (v: number) => (sd.a + sd.b * v) ** 2;

  const daysOf = (m: (typeof matchups)[number]) =>
    [...new Set([...Object.keys(m.homeByPeriod), ...Object.keys(m.awayByPeriod ?? {})])]
      .map(Number)
      .sort((a, b) => a - b);
  const days = [...new Set(matchups.flatMap(daysOf))].sort((a, b) => a - b);

  // Each team's roster as of each day.
  const rostersOn = new Map<number, Map<number, RosterPlayer[]>>();
  for (const sp of days) {
    const r = await cachedJson(new URL(`roster-${sp}.json`, ROSTERS), () =>
      fetchLeague(cfg, ["mRoster"], { scoringPeriodId: sp }),
    );
    rostersOn.set(sp, new Map(parseTeams(r).map((t) => [t.id, t.roster])));
  }
  console.log(`rosters: ${days.length} days`);

  // Game logs (this season and last) for everyone rostered at any point.
  const ids = [
    ...new Set([...rostersOn.values()].flatMap((m) => [...m.values()].flat().map((p) => p.id))),
  ];
  const logs = new Map<number, { t: number; fp: number }[]>();
  for (const id of ids) {
    const all = [...(await gameLog(id, PRIOR)), ...(await gameLog(id, SEASON))]
      .filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0)
      .map((g) => ({ t: Date.parse(g.date), fp: fantasyPoints(withDerived(g.line), scoring) }))
      .sort((a, b) => a.t - b.t);
    logs.set(id, all);
  }
  console.log(`game logs: ${ids.length} players`);

  const firstTip = new Map<number, number>();
  for (const g of games)
    firstTip.set(g.scoringPeriodId, Math.min(firstTip.get(g.scoringPeriodId) ?? Infinity, g.date));
  const teamGames = (pro: number, from: number, to: number) =>
    games.filter(
      (g) => (g.homeProTeamId === pro || g.awayProTeamId === pro) && g.date >= from && g.date < to,
    ).length;

  /** Projection before `cutoff`, or 0 when he's out (his team has played 2+ games without him). */
  const projection = (p: RosterPlayer, cutoff: number) => {
    const before = (logs.get(p.id) ?? []).filter((g) => g.t < cutoff);
    if (!before.length) return 0;
    if (teamGames(p.proTeamId, before.at(-1)!.t + 1, cutoff) >= 2) return 0;
    const last = before.slice(-LAST_N);
    return last.reduce((a, g) => a + g.fp, 0) / last.length;
  };

  /** Points to come and their variance for a roster, from day `from` through the week's days. */
  const toCome = (roster: RosterPlayer[], weekDays: number[], cutoff: number) => {
    const value = new Map(roster.map((p) => [p.id, projection(p, cutoff)]));
    let e = 0;
    let v = 0;
    for (const d of weekDays) {
      const teams = new Set(
        games
          .filter((g) => g.scoringPeriodId === d)
          .flatMap((g) => [g.homeProTeamId, g.awayProTeamId]),
      );
      const players = roster
        .filter((p) => p.slot !== "IR")
        .map((p) => ({
          id: p.id,
          eligible: p.positions as Position[],
          value: teams.has(p.proTeamId) ? (value.get(p.id) ?? 0) : 0,
          currentSlot: "BE",
        }));
      const best = optimizeLineup(players, settings.slotCounts);
      for (const x of players) {
        const slot = best.slotOf.get(x.id);
        if (x.value > 0 && slot !== "BE" && slot !== "IR") {
          e += x.value;
          v += startVar(x.value);
        }
      }
    }
    return { e, v };
  };

  const states: State[] = [];
  for (const m of matchups) {
    const final = m.homePoints - (m.awayPoints ?? 0);
    if (final === 0) continue;
    const wd = daysOf(m);
    let banked = 0;
    for (let k = 0; k < wd.length; k++) {
      const sp = wd[k]!;
      const cutoff = firstTip.get(sp) ?? Infinity;
      const rosters = rostersOn.get(sp)!;
      const h = toCome(rosters.get(m.homeTeamId) ?? [], wd.slice(k), cutoff);
      const a = toCome(rosters.get(m.awayTeamId!) ?? [], wd.slice(k), cutoff);
      states.push({
        week: m.period,
        home: m.homeTeamId,
        daysLeft: wd.length - k,
        mean: banked + h.e - a.e,
        eHome: h.e,
        eAway: a.e,
        vHome: h.v,
        vAway: a.v,
        won: final > 0,
      });
      banked += (m.homeByPeriod[sp] ?? 0) - (m.awayByPeriod?.[sp] ?? 0);
    }
  }

  type Model = (s: State) => number;
  const p = (mean: number, sd: number) =>
    sd > 0 ? normalCdf(mean / sd) : mean > 0 ? 1 : mean < 0 ? 0 : 0.5;
  const current: Model = (s) => p(s.mean, CURRENT_CV * Math.hypot(s.eHome, s.eAway));
  const candidate: Model = (s) => p(s.mean, Math.sqrt(s.vHome + s.vAway));
  const sq = (s: State, f: Model) => (f(s) - (s.won ? 1 : 0)) ** 2;
  const brier = (xs: State[], f: Model) => xs.reduce((a, s) => a + sq(s, f), 0) / xs.length;

  // The gate: per matchup-week mean difference (C - current), mean +- 1.96 SE.
  const byMatchup = new Map<string, number[]>();
  for (const s of states) {
    const k = `${s.week}:${s.home}`;
    if (!byMatchup.has(k)) byMatchup.set(k, []);
    byMatchup.get(k)!.push(sq(s, candidate) - sq(s, current));
  }
  const diffs = [...byMatchup.values()].map((xs) => xs.reduce((a, x) => a + x, 0) / xs.length);
  const mean = diffs.reduce((a, x) => a + x, 0) / diffs.length;
  const se = Math.sqrt(
    diffs.reduce((a, x) => a + (x - mean) ** 2, 0) / (diffs.length - 1) / diffs.length,
  );

  const late = states.filter((s) => s.daysLeft <= 2);
  console.log(`\nstates: ${states.length} matchup-mornings, ${diffs.length} matchup-weeks`);
  console.log("\n| Model | Brier | Brier, last 2 days |\n|---|---:|---:|");
  console.log(
    `| current (0.14 x to come) | ${brier(states, current).toFixed(4)} | ${brier(late, current).toFixed(4)} |`,
  );
  console.log(
    `| candidate C | ${brier(states, candidate).toFixed(4)} | ${brier(late, candidate).toFixed(4)} |`,
  );
  console.log(
    `\nC - current, by matchup-week: ${mean.toFixed(4)} [${(mean - 1.96 * se).toFixed(4)}, ${(mean + 1.96 * se).toFixed(4)}]`,
  );
  console.log(
    mean < 0 && mean + 1.96 * se < 0 ? "PASSES the pre-registered gate" : "does NOT pass the gate",
  );

  console.log("\nReliability (predicted P(home wins) bucket -> actual):");
  console.log("| Predicted | current: n, actual | candidate C: n, actual |\n|---|---:|---:|");
  const buckets = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0001];
  for (let i = 0; i < buckets.length - 1; i++) {
    const [lo, hi] = [buckets[i]!, buckets[i + 1]!];
    const cell = (f: Model) => {
      const xs = states.filter((s) => f(s) >= lo && f(s) < hi);
      const won = xs.filter((s) => s.won).length;
      return xs.length ? `${xs.length}, ${((100 * won) / xs.length).toFixed(0)}%` : "0, -";
    };
    console.log(
      `| ${(lo * 100).toFixed(0)}-${Math.min(100, hi * 100).toFixed(0)}% | ${cell(current)} | ${cell(candidate)} |`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
