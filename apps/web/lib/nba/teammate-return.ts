// A fill-in's projection once the regular he replaced returns (MODEL_CARD, teammate returns
// test 4, passed 2026-11-17; ADR-064). When a regular misses 5+ straight team games, a
// teammate at his position whose minutes rose 6+ meanwhile keeps only part of his surge: from
// the regular's return his FP/G is today's projection minus a share λ of the gap between it
// and his projection from only the games the regular played. Pure: the nightly job supplies
// game logs (lib/nba/teammate-return-run.ts).

import type { RosterPlayer } from "@fantasy-copilot/espn";
import { absenceOf } from "./availability";
import { perGameProjection } from "./projection";
import type { InjuryReport } from "@fantasy-copilot/nba-data";

/** λ by position group, fitted on 2017-18 to 2023-24 (MODEL_CARD test 4). */
export const SHARE = { G: 0.23, F: 0.07, C: 0.49 } as const;
export type Group = keyof typeof SHARE;

/** The test's events: a regular (20+ minutes) misses 5+ straight team games. */
const MIN_MISSED = 5;
const REGULAR_MIN = 20;
/** The fill-in: minutes up 6+ during the absence, 10+ games so far, 3+ during it. */
const MIN_SHIFT = 6;
const MIN_GAMES = 10;
const MIN_DURING = 3;
/** With fewer games than this before the absence, the regular's minutes are ESPN's projection. */
const FEW_GAMES = 5;

/** Guards, forwards, centers, by ESPN's primary position (else his first eligible one). */
export function groupOf(p: Pick<RosterPlayer, "defaultPosition" | "positions">): Group | null {
  const pos = p.defaultPosition ?? p.positions[0];
  if (pos === "PG" || pos === "SG") return "G";
  if (pos === "SF" || pos === "PF") return "F";
  return pos === "C" ? "C" : null;
}

/** One regular-season game he played: scoring period, minutes, fantasy points. */
export interface LogGame {
  sp: number;
  min: number;
  fp: number;
}

export interface TeammateEffect {
  player: number;
  teammate: number;
  teammateName: string;
  group: Group;
  /** Today's projection minus the one from games with the teammate (FP/G), and its share λ. */
  gap: number;
  lambda: number;
  minShift: number;
  /** The absence: its first and last missed team game; `ongoing` while he hasn't played since. */
  from: number;
  through: number;
  ongoing: boolean;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** His projection from these games alone (the backtest's way: his ESPN projection as prior). */
function projectionFrom(p: RosterPlayer, games: LogGame[]): number {
  const total = games.reduce((a, g) => a + g.fp, 0);
  return perGameProjection({
    ...p,
    season: games.length
      ? {
          avg: total / games.length,
          total,
          stats: { ...(p.season?.stats ?? {}), MIN: mean(games.map((g) => g.min)) },
        }
      : null,
    games: games.map((g) => ({
      gameId: 0,
      scoringPeriodId: g.sp,
      points: g.fp,
      line: { MIN: g.min },
    })),
  }).fppg;
}

/** The latest run of 5+ straight team games he missed (scoring periods), or null. */
export function latestAbsence(played: Set<number>, schedule: number[]): number[] | null {
  let end = schedule.length - 1;
  while (end >= 0) {
    while (end >= 0 && played.has(schedule[end]!)) end--;
    let start = end;
    while (start > 0 && !played.has(schedule[start - 1]!)) start--;
    if (end >= 0 && end - start + 1 >= MIN_MISSED) return schedule.slice(start, end + 1);
    end = start - 1;
  }
  return null;
}

/**
 * Each regular's most recent absence of 5+ straight team games before `today`, and the
 * teammates at his position it lifted. `teamGames`: each pro team's scoring periods with a game
 * before `today`, in order.
 */
export function teammateEffects(
  players: RosterPlayer[],
  logs: Map<number, LogGame[]>,
  teamGames: Map<number, number[]>,
): TeammateEffect[] {
  const out: TeammateEffect[] = [];
  for (const t of players) {
    const tLog = logs.get(t.id);
    const group = groupOf(t);
    const schedule = teamGames.get(t.proTeamId);
    if (!tLog?.length || !group || !schedule) continue;
    const played = new Set(tLog.map((g) => g.sp));
    const run = latestAbsence(played, schedule);
    if (!run) continue;
    const from = run[0]!;
    const through = run.at(-1)!;
    const before = tLog.filter((g) => g.sp < from);
    if (!before.length) continue;
    const minutes =
      before.length >= FEW_GAMES
        ? mean(before.slice(-10).map((g) => g.min))
        : (t.projection?.stats?.MIN ?? 0);
    if (minutes < REGULAR_MIN) continue;
    const missed = new Set(run);
    const ongoing = through === schedule.at(-1) && !tLog.some((g) => g.sp > through);
    for (const p of players) {
      if (p.id === t.id || p.proTeamId !== t.proTeamId || groupOf(p) !== group) continue;
      const pLog = logs.get(p.id);
      if (!pLog || pLog.length < MIN_GAMES) continue;
      const during = pLog.filter((g) => missed.has(g.sp));
      if (during.length < MIN_DURING) continue;
      const pre = pLog.filter((g) => g.sp < from);
      const minShift =
        mean(during.map((g) => g.min)) - (pre.length ? mean(pre.map((g) => g.min)) : 0);
      if (minShift < MIN_SHIFT) continue;
      const gap =
        projectionFrom(p, pLog) -
        projectionFrom(
          p,
          pLog.filter((g) => played.has(g.sp)),
        );
      out.push({
        player: p.id,
        teammate: t.id,
        teammateName: t.name,
        group,
        gap,
        lambda: SHARE[group],
        minShift,
        from,
        through,
        ongoing,
      });
    }
  }
  return out;
}

/**
 * Players with their change attached: from the teammate's estimated return while he's out
 * (none if he's out for the season), from today once he's back. A player lifted by two
 * returns takes the larger drop.
 */
export function withTeammateReturns<T extends RosterPlayer>(
  players: T[],
  effects: TeammateEffect[],
  injuries: Pick<InjuryReport, "playerId" | "status" | "returnDate">[],
  today: number,
  /** Where to find the teammate's own status (else among `players`). */
  everyone: RosterPlayer[] = players,
): T[] {
  if (!effects.length) return players;
  const reports = new Map(injuries.map((i) => [i.playerId, i]));
  const best = new Map<number, NonNullable<RosterPlayer["teammateReturn"]>>();
  for (const e of effects) {
    const status = everyone.find((p) => p.id === e.teammate)?.injuryStatus ?? null;
    const absence = e.ongoing
      ? absenceOf({ id: e.teammate, injuryStatus: status }, reports.get(e.teammate), today)
      : null;
    if (absence?.season) continue;
    const change = {
      day: absence?.outUntil ?? today,
      shift: -e.lambda * e.gap,
      teammate: e.teammateName,
    };
    const had = best.get(e.player);
    if (!had || change.shift < had.shift) best.set(e.player, change);
  }
  return players.map((p) => {
    const c = best.get(p.id);
    return c ? { ...p, teammateReturn: c } : p;
  });
}

/** Stored effects this old (or none) are recomputed by the next gameday run, not only the nightly. */
export const STALE_MS = 26 * 3600_000;
export const returnsStale = (computedAt: Date | null, now = Date.now()) =>
  !computedAt || now - computedAt.getTime() > STALE_MS;

/** His FP/G from `day` on, given today's (never below 0). */
export const afterReturn = (fppg: number, c: NonNullable<RosterPlayer["teammateReturn"]>) =>
  Math.max(0, fppg + c.shift);
