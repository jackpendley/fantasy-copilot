// Calibrate the weekly win probability on this league's 2025-26 season (read-only; ESPN only).
// Pre-registered in docs/MODEL_CARD.md ("Weekly win probability"): fit on weeks 2-10, test on
// weeks 11-19.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/calibrate-win-prob.ts

import {
  fetchLeague,
  fetchProSchedule,
  parseMatchups,
  parseProSchedule,
  parseSettings,
} from "@fantasy-copilot/espn";
import { espnConfig } from "../lib/env";

const SEASON = 2026; // 2025-26, named by its end year
const FIT_WEEKS = [2, 10];
const TEST_WEEKS = [11, 19];

interface State {
  week: number;
  daysLeft: number;
  /** Margin so far (home - away), expected points still to come, final margin. */
  banked: number;
  eHome: number;
  eAway: number;
  final: number;
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

type Sd = (s: State) => number;
const current: Sd = (s) => Math.hypot(0.14 * s.eHome, 0.14 * s.eAway);
const candidate =
  (a: number, b: number): Sd =>
  (s) =>
    Math.sqrt(a * (s.eHome + s.eAway) + b * (s.eHome ** 2 + s.eAway ** 2));

const pWin = (s: State, sd: Sd) => {
  const mean = s.banked + s.eHome - s.eAway;
  const v = sd(s);
  return v > 0 ? normalCdf(mean / v) : mean > 0 ? 1 : mean < 0 ? 0 : 0.5;
};
const brier = (xs: State[], sd: Sd) =>
  xs.reduce((a, s) => a + (pWin(s, sd) - (s.final > 0 ? 1 : 0)) ** 2, 0) / xs.length;

async function main() {
  const cfg = { ...espnConfig(), season: SEASON };
  const [raw, schedule] = await Promise.all([
    fetchLeague(cfg, ["mMatchupScore", "mSettings"]),
    fetchProSchedule(SEASON),
  ]);
  const weeks = parseSettings(raw).regularSeasonWeeks;
  const matchups = parseMatchups(raw).filter((m) => m.period <= weeks && m.awayTeamId != null);
  const gamesOn = new Map<number, number>();
  for (const g of parseProSchedule(schedule))
    gamesOn.set(g.scoringPeriodId, (gamesOn.get(g.scoringPeriodId) ?? 0) + 1);

  // Each team's points per NBA game on the slate, from the weeks before (point in time).
  const history = new Map<number, { pts: number; games: number }[]>();
  const record = (team: number, week: number, pts: number, games: number) => {
    if (!history.has(team)) history.set(team, []);
    history.get(team)![week] = { pts, games };
  };
  const daysOf = (m: (typeof matchups)[number]) =>
    [...new Set([...Object.keys(m.homeByPeriod), ...Object.keys(m.awayByPeriod ?? {})])]
      .map(Number)
      .sort((a, b) => a - b);
  for (const m of matchups) {
    const slate = daysOf(m).reduce((a, d) => a + (gamesOn.get(d) ?? 0), 0);
    record(m.homeTeamId, m.period, m.homePoints, slate);
    record(m.awayTeamId!, m.period, m.awayPoints ?? 0, slate);
  }
  const rateBefore = (team: number, week: number) => {
    const past = (history.get(team) ?? []).slice(1, week).filter(Boolean);
    const games = past.reduce((a, w) => a + w.games, 0);
    return games ? past.reduce((a, w) => a + w.pts, 0) / games : null;
  };

  const states: State[] = [];
  for (const m of matchups) {
    if (m.period < 2) continue;
    const rh = rateBefore(m.homeTeamId, m.period);
    const ra = rateBefore(m.awayTeamId!, m.period);
    if (rh == null || ra == null) continue;
    const days = daysOf(m);
    const final = m.homePoints - (m.awayPoints ?? 0);
    let banked = 0;
    for (let k = 0; k < days.length; k++) {
      const left = days.slice(k).reduce((a, d) => a + (gamesOn.get(d) ?? 0), 0);
      states.push({
        week: m.period,
        daysLeft: days.length - k,
        banked,
        eHome: rh * left,
        eAway: ra * left,
        final,
      });
      banked += (m.homeByPeriod[days[k]!] ?? 0) - (m.awayByPeriod?.[days[k]!] ?? 0);
    }
  }
  const inWeeks = ([lo, hi]: number[]) => states.filter((s) => s.week >= lo! && s.week <= hi!);
  const fit = inWeeks(FIT_WEEKS);
  const test = inWeeks(TEST_WEEKS);

  // Maximum likelihood (normal) for a and b on the fit weeks.
  const nll = (a: number, b: number) =>
    fit.reduce((acc, s) => {
      const v = a * (s.eHome + s.eAway) + b * (s.eHome ** 2 + s.eAway ** 2);
      if (v <= 0) return acc + 1e6;
      const r = s.final - s.banked - (s.eHome - s.eAway);
      return acc + 0.5 * Math.log(v) + (r * r) / (2 * v);
    }, 0);
  let best = { a: 0, b: 0, nll: Infinity };
  for (let a = 0; a <= 80; a += 1)
    for (let b = 0; b <= 0.06; b += 0.0005) {
      const v = nll(a, b);
      if (v < best.nll) best = { a, b, nll: v };
    }
  const cand = candidate(best.a, best.b);

  console.log(
    `states: ${states.length} (fit weeks ${FIT_WEEKS.join("-")}: ${fit.length}, test weeks ${TEST_WEEKS.join("-")}: ${test.length})`,
  );
  console.log(`fitted: a = ${best.a}, b = ${best.b.toFixed(4)}`);
  const late = test.filter((s) => s.daysLeft <= 2);
  console.log("\n| Model | Brier (test) | Brier, last 2 days (test) |\n|---|---:|---:|");
  console.log(
    `| current (0.14 x remaining) | ${brier(test, current).toFixed(4)} | ${brier(late, current).toFixed(4)} |`,
  );
  console.log(`| candidate | ${brier(test, cand).toFixed(4)} | ${brier(late, cand).toFixed(4)} |`);

  console.log("\nReliability on the test weeks (predicted P(home wins) bucket -> actual):");
  console.log("| Predicted | current: n, actual | candidate: n, actual |\n|---|---:|---:|");
  const buckets = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0001];
  for (let i = 0; i < buckets.length - 1; i++) {
    const [lo, hi] = [buckets[i]!, buckets[i + 1]!];
    const cell = (sd: Sd) => {
      const xs = test.filter((s) => {
        const p = pWin(s, sd);
        return p >= lo && p < hi;
      });
      const won = xs.filter((s) => s.final > 0).length;
      return xs.length ? `${xs.length}, ${((100 * won) / xs.length).toFixed(0)}%` : "0, -";
    };
    console.log(
      `| ${(lo * 100).toFixed(0)}-${Math.min(100, hi * 100).toFixed(0)}% | ${cell(current)} | ${cell(cand)} |`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
