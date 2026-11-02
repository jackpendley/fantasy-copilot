// Manager activity from lineups (MODEL_CARD pre-registration 2026-11-02): how well three
// estimates of `act` (share of days a manager sets his lineup) predict a team's set-day share in
// the next three weeks, on this league's 2025-26 season. Read-only: the daily rosters and game
// logs cached by scripts/backtest-win-prob.ts (data/local/, gitignored: other managers' rosters).
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/backtest-activity.ts

import { existsSync, readFileSync } from "node:fs";
import {
  fetchLeague,
  fetchProSchedule,
  parseMatchups,
  parseProSchedule,
  parseSettings,
  parseTeams,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import { isStartingSlot, slotAccepts, type Position } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { espnConfig } from "../lib/env";
import { etDate } from "../lib/nba/calendar";

const SEASON = 2026;
const LOCAL = new URL("../data/local/", import.meta.url);
const ROSTERS = new URL("winprob-2026/", LOCAL);
const LOGS = new URL("backtest/", LOCAL);

/** Prior for today's formula: the neutral 0.7 with 21 days' weight (no last season in the cache). */
const MOVES_PER_ACTIVE_DAY = 2.5;
const PRIOR_ACT = 0.7;
const PRIOR_DAYS = 21;
/** Candidate B's shrinkage toward the league's set-day share. */
const SHRINK_DAYS = 14;
const T_11 = 2.201; // 95% two-sided t quantile, 11 degrees of freedom (12 teams)

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function playedDays(id: number): Set<string> | null {
  const f = new URL(`${id}-${SEASON}.json`, LOGS);
  if (!existsSync(f)) return null;
  const log = JSON.parse(readFileSync(f, "utf8")) as GameLogEntry[];
  return new Set(
    log
      .filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0)
      .map((g) => etDate(new Date(g.date))),
  );
}

async function main() {
  const raw = await fetchLeague({ ...espnConfig(), season: SEASON }, [
    "mMatchupScore",
    "mSettings",
  ]);
  const settings = parseSettings(raw);
  const games = parseProSchedule(await fetchProSchedule(SEASON));
  // Regular-season week of each day, from the matchups' daily scores.
  const weekOf = new Map<number, number>();
  for (const m of parseMatchups(raw))
    if (m.period <= settings.regularSeasonWeeks)
      for (const sp of Object.keys(m.homeByPeriod)) weekOf.set(Number(sp), m.period);
  const days = [...weekOf.keys()].sort((a, b) => a - b);
  const dateOf = new Map<number, string>();
  const playing = new Map<number, Set<number>>();
  for (const g of games) {
    dateOf.set(g.scoringPeriodId, etDate(new Date(g.date)));
    if (!playing.has(g.scoringPeriodId)) playing.set(g.scoringPeriodId, new Set());
    playing.get(g.scoringPeriodId)!.add(g.homeProTeamId).add(g.awayProTeamId);
  }

  const played = new Map<number, Set<string> | null>();
  const playedOn = (p: RosterPlayer, sp: number) => {
    if (!played.has(p.id)) played.set(p.id, playedDays(p.id));
    const s = played.get(p.id);
    // No cached log: count his team's game (unknown players are rare).
    return s ? s.has(dateOf.get(sp) ?? "") : (playing.get(sp)?.has(p.proTeamId) ?? false);
  };

  // Per team per day: was the lineup set, and how many moves to a starting slot were made.
  type Day = { sp: number; week: number; set: boolean; moves: number };
  const byTeam = new Map<number, Day[]>();
  let previous = new Map<number, Map<number, string>>();
  let missing = 0;
  for (const sp of days) {
    const file = new URL(`roster-${sp}.json`, ROSTERS);
    if (!existsSync(file)) {
      missing++;
      continue;
    }
    const teams = parseTeams(JSON.parse(readFileSync(file, "utf8")));
    const current = new Map<number, Map<number, string>>();
    for (const t of teams) {
      const slots = new Map(t.roster.map((p) => [p.id, p.slot ?? "BE"]));
      current.set(t.id, slots);
      const starters = t.roster.filter((p) => isStartingSlot(p.slot ?? "BE"));
      const useless = starters.filter((p) => !playedOn(p, sp)).map((p) => p.slot!);
      // Starting slots nobody holds.
      const open: string[] = [];
      const held = new Map<string, number>();
      for (const p of starters) held.set(p.slot!, (held.get(p.slot!) ?? 0) + 1);
      for (const [slot, n] of Object.entries(settings.slotCounts))
        if (isStartingSlot(slot)) for (let k = held.get(slot) ?? 0; k < n; k++) open.push(slot);
      const free = [...useless, ...open];
      const bench = t.roster.filter((p) => (p.slot ?? "BE") === "BE" && playedOn(p, sp));
      const set = !bench.some((p) =>
        free.some((slot) => slotAccepts(slot, p.positions as Position[])),
      );
      const before = previous.get(t.id);
      const moves = before
        ? t.roster.filter(
            (p) => isStartingSlot(p.slot ?? "BE") && !isStartingSlot(before.get(p.id) ?? "BE"),
          ).length
        : 0;
      if (!byTeam.has(t.id)) byTeam.set(t.id, []);
      byTeam.get(t.id)!.push({ sp, week: weekOf.get(sp)!, set, moves });
    }
    previous = current;
  }
  console.log(`days ${days.length} (missing ${missing}), teams ${byTeam.size}`);

  const lastWeek = Math.max(...weekOf.values());
  type Model = "A" | "B" | "C";
  const errs = new Map<number, Record<Model, number[]>>();
  for (let k = 2; k <= Math.min(18, lastWeek - 1); k++) {
    const upTo = (d: Day) => d.week <= k;
    const next = (d: Day) => d.week > k && d.week <= k + 3;
    const leagueShare = mean(
      [...byTeam.values()]
        .flat()
        .filter(upTo)
        .map((d) => (d.set ? 1 : 0)),
    );
    for (const [team, ds] of byTeam) {
      const past = ds.filter(upTo);
      const future = ds.filter(next);
      if (!past.length || !future.length) continue;
      const truth = mean(future.map((d) => (d.set ? 1 : 0)));
      const n = past.length;
      const now = Math.min(1, past.reduce((a, d) => a + d.moves, 0) / (MOVES_PER_ACTIVE_DAY * n));
      const w = n / (n + PRIOR_DAYS);
      const a = w * now + (1 - w) * PRIOR_ACT;
      const setDays = past.filter((d) => d.set).length;
      const b = (setDays + SHRINK_DAYS * leagueShare) / (n + SHRINK_DAYS);
      if (!errs.has(team)) errs.set(team, { A: [], B: [], C: [] });
      const e = errs.get(team)!;
      e.A.push(Math.abs(a - truth));
      e.B.push(Math.abs(b - truth));
      e.C.push(Math.abs(1 - truth));
    }
  }
  const perTeam = (m: Model) => [...errs.values()].map((e) => mean(e[m]));
  const diff = (m: Model) => {
    const d = perTeam(m).map((x, i) => x - perTeam("A")[i]!);
    const md = mean(d);
    const sd = Math.sqrt(d.reduce((s, x) => s + (x - md) ** 2, 0) / (d.length - 1));
    const half = (T_11 * sd) / Math.sqrt(d.length);
    return `${md.toFixed(4)} [${(md - half).toFixed(4)}, ${(md + half).toFixed(4)}]`;
  };
  console.log(
    "\n| Estimate of act | MAE (mean of teams) | vs A (95% CI, by team) |\n| --- | ---: | --- |",
  );
  console.log(`| A today (move counts) | ${mean(perTeam("A")).toFixed(4)} | |`);
  console.log(`| B set-day share, shrunk | ${mean(perTeam("B")).toFixed(4)} | ${diff("B")} |`);
  console.log(`| C everyone 1.0 | ${mean(perTeam("C")).toFixed(4)} | ${diff("C")} |`);
  const share = (ds: Day[]) => mean(ds.map((d) => (d.set ? 1 : 0)));
  console.log(
    `\nSeason set-day share by team: ${[...byTeam.values()]
      .map((ds) => share(ds).toFixed(2))
      .sort()
      .join(" ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
