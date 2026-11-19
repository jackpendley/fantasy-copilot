// The context-aware projection (MODEL_CARD, teammate absences by impact: passed 2026-11-19).
// A player's earlier games are divided by their context factor (which regulars were out then,
// each weighted by his share of the team's fantasy points above a floor), the projection is
// made from those full-strength games, and a game's own factor multiplies it. Pure: the
// backtest (scripts/teammate-context.ts) and production (lib/nba/context-run.ts) share it.

import { PRO_TEAM_BY_ID, type RosterPlayer } from "@fantasy-copilot/espn";
import {
  buildMatcher,
  toEspnTeam,
  type InjuryReport,
  type LineupEntry,
} from "@fantasy-copilot/nba-data";
import { absenceOf } from "./availability";
import { groupOf } from "./teammate-return";

/** As tested (frozen on the exploration seasons). */
export const K = 0.75;
export const SAME = 2;
export const FLOOR = 0.1;
export const CAP = 0.6;
/** A regular plays 20+ minutes a game over his last 10. */
export const REGULAR_MIN = 20;
/** An absent teammate is counted with 10+ minutes a game over his last 10 (5+ games). */
const ROTATION_MIN = 10;
const MIN_GAMES = 5;
const LAST = 10;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Absent {
  /** His share of the team's fantasy points (last 10 games each). */
  share: number;
  /** Straight team games he has missed, this one included. */
  idx: number;
  /** Guards, forwards, centers ("G" | "F" | "C"), by his position. */
  group: string | null;
  /** His minutes a game over his last 10. */
  min10: number;
}

/** A game a player played: the team-game ("side", unique per game and team), his team, tip. */
export interface Appearance {
  side: string;
  team: string | undefined;
  t: number;
  fp: number;
  min: number;
}

/** A game's context factor for a player in `group`: 1 when no regular above the floor is out. */
export function contextFactor(absent: readonly Absent[], group: string | null): number {
  return (
    1 +
    K *
      Math.min(
        CAP,
        absent.reduce(
          (t, a) =>
            t +
            (a.min10 >= REGULAR_MIN
              ? Math.max(0, a.share - FLOOR) * (a.group === group ? SAME : 1)
              : 0),
          0,
        ),
      )
  );
}

/**
 * Who was absent from each team-game (keyed by side), from every player's games this season
 * (sorted by tip). Absent: 5+ games before it, his latest for this team, 10+ minutes a game
 * over his last 10, and he didn't play; a teammate whose next game is for another team was
 * traded. His share: FP/G over his last 10 ÷ the team's FP per game over its last 10.
 */
export function absencesByGame(
  logs: ReadonlyMap<number, readonly Appearance[]>,
  groupOf: (player: number) => string | null,
): Map<string, Absent[]> {
  const sideFp = new Map<string, number>();
  for (const gs of logs.values())
    for (const g of gs) sideFp.set(g.side, (sideFp.get(g.side) ?? 0) + g.fp);
  // Each team's games in order, and everyone who played for it.
  const schedules = new Map<string, { side: string; t: number }[]>();
  const members = new Map<string, Set<number>>();
  const seen = new Set<string>();
  for (const [id, gs] of logs)
    for (const g of gs) {
      if (!g.team) continue;
      if (!members.has(g.team)) members.set(g.team, new Set());
      members.get(g.team)!.add(id);
      if (seen.has(g.side)) continue;
      seen.add(g.side);
      schedules.set(g.team, [...(schedules.get(g.team) ?? []), { side: g.side, t: g.t }]);
    }
  for (const list of schedules.values()) list.sort((a, b) => a.t - b.t);
  const played = new Map([...logs].map(([id, gs]) => [id, new Set(gs.map((g) => g.side))]));
  const teamBefore = (id: number, t: number) => logs.get(id)!.findLast((x) => x.t < t)?.team;
  const teamAfter = (id: number, t: number) => logs.get(id)!.find((x) => x.t > t)?.team;

  const out = new Map<string, Absent[]>();
  for (const [team, schedule] of schedules)
    schedule.forEach((tg, k) => {
      const last = schedule.slice(Math.max(0, k - LAST), k);
      const absent: Absent[] = [];
      out.set(tg.side, absent);
      if (last.length < MIN_GAMES) return;
      const teamFp = mean(last.map((x) => sideFp.get(x.side) ?? 0));
      for (const id of members.get(team)!) {
        if (played.get(id)!.has(tg.side)) continue;
        const before = logs.get(id)!.filter((g) => g.t < tg.t);
        if (before.length < MIN_GAMES || teamBefore(id, tg.t) !== team) continue;
        const next = teamAfter(id, tg.t);
        if (next && next !== team) continue;
        const recent = before.slice(-LAST);
        const min10 = mean(recent.map((g) => g.min));
        if (min10 < ROTATION_MIN) continue;
        let idx = 0;
        for (let j = k; j >= 0 && !played.get(id)!.has(schedule[j]!.side); j--) idx++;
        absent.push({
          share: mean(recent.map((g) => g.fp)) / teamFp,
          idx,
          group: groupOf(id),
          min10,
        });
      }
    });
  return out;
}

/** A team's rotation players now (as for its next game), with their shares. */
export interface Regular extends Omit<Absent, "idx"> {
  player: number;
}

/**
 * Each team's rotation players as of `now`, for its next game: the same rules as an absence
 * (5+ games, his latest for this team, 10+ minutes over his last 10), measured over the team's
 * last 10 games. Whether he plays is decided elsewhere (injury report, NBA.com).
 */
export function regularsNow(
  logs: ReadonlyMap<number, readonly Appearance[]>,
  groupOf: (player: number) => string | null,
  now: number,
): Map<string, Regular[]> {
  const sideFp = new Map<string, number>();
  const teamSides = new Map<string, Map<string, number>>();
  for (const gs of logs.values())
    for (const g of gs) {
      if (g.t >= now) continue;
      sideFp.set(g.side, (sideFp.get(g.side) ?? 0) + g.fp);
      if (g.team) {
        if (!teamSides.has(g.team)) teamSides.set(g.team, new Map());
        teamSides.get(g.team)!.set(g.side, g.t);
      }
    }
  const out = new Map<string, Regular[]>();
  for (const [team, sides] of teamSides) {
    const last = [...sides].sort((a, b) => a[1] - b[1]).slice(-LAST);
    const regs: Regular[] = [];
    out.set(team, regs);
    if (last.length < MIN_GAMES) continue;
    const teamFp = mean(last.map(([side]) => sideFp.get(side) ?? 0));
    for (const [id, gs] of logs) {
      const before = gs.filter((g) => g.t < now);
      if (before.length < MIN_GAMES || before.at(-1)!.team !== team) continue;
      const recent = before.slice(-LAST);
      const min10 = mean(recent.map((g) => g.min));
      if (min10 < ROTATION_MIN) continue;
      regs.push({
        player: id,
        share: mean(recent.map((g) => g.fp)) / teamFp,
        group: groupOf(id),
        min10,
      });
    }
  }
  return out;
}

/**
 * What each of a player's games loses when divided by its context factor: FP and minutes
 * (only games with a factor above 1). The projection subtracts these from his season line.
 */
export function pastAdjustments(
  logs: ReadonlyMap<number, readonly (Appearance & { game: number })[]>,
  absences: ReadonlyMap<string, readonly Absent[]>,
  groupOf: (player: number) => string | null,
): Map<number, { game: number; factor: number; fp: number; min: number }[]> {
  const out = new Map<number, { game: number; factor: number; fp: number; min: number }[]>();
  for (const [id, gs] of logs) {
    const adj = [];
    for (const g of gs) {
      const x = contextFactor(absences.get(g.side) ?? [], groupOf(id));
      if (x > 1)
        adj.push({ game: g.game, factor: x, fp: g.fp * (1 - 1 / x), min: g.min * (1 - 1 / x) });
    }
    if (adj.length) out.set(id, adj);
  }
  return out;
}

/** A player's context as attached (RosterPlayer.context). */
export interface PlayerContext {
  adj: [number, number, number, number, number][];
  days: { day: number; factor: number; out: string[] }[];
}

/**
 * A player's factor from each day on (from `today`): his team's regulars who are out, each
 * until the day he's expected back (`outUntil`: a scoring period, Infinity for the season,
 * null when he plays). Consecutive days with the same factor merge. Pure.
 */
export function factorDays(
  player: number,
  group: string | null,
  regulars: readonly (Regular & { name: string })[],
  outUntil: (player: number) => number | null,
  today: number,
): PlayerContext["days"] {
  const out = regulars
    .filter((r) => r.player !== player)
    .map((r) => ({ r, until: outUntil(r.player) }))
    .filter(
      (x): x is { r: Regular & { name: string }; until: number } =>
        x.until != null && x.until > today,
    );
  const days: PlayerContext["days"] = [];
  const breaks = [
    today,
    ...new Set(out.map((x) => x.until).filter((d) => Number.isFinite(d))),
  ].sort((a, b) => a - b);
  for (const day of breaks) {
    const now = out.filter((x) => x.until > day);
    const factor = contextFactor(
      now.map((x) => ({ share: x.r.share, idx: 1, group: x.r.group, min10: x.r.min10 })),
      group,
    );
    const names = now
      .filter((x) => x.r.min10 >= REGULAR_MIN && x.r.share > FLOOR)
      .map((x) => x.r.name);
    if (days.at(-1)?.factor !== factor) days.push({ day, factor, out: names });
  }
  return days;
}

/** His factor on scoring period `sp` (1 without a context, or before its first day). */
export function factorOn(p: { context?: PlayerContext }, sp: number): number {
  let f = 1;
  for (const d of p.context?.days ?? []) if (d.day <= sp) f = d.factor;
  return f;
}

/** What the nightly step stores (lib/nba/context-run.ts). */
export interface ContextPayload {
  /** The scoring period it was computed for (games before it count). */
  asOf: number;
  /** Per player id: his games with a factor above 1 ([game id, scoring period, factor, FP, minutes]). */
  adj: Record<string, PlayerContext["adj"]>;
  /** Per pro team id: its regulars now, with names to match NBA.com's lineups. */
  regulars: Record<string, (Regular & { name: string })[]>;
}

/**
 * When each regular is expected back (scoring period; Infinity for the season; null when he
 * plays): an ESPN absence (ruled out, with its estimated return), or NBA.com listing him
 * inactive today (back tomorrow at the latest). Pure.
 */
export function outUntilFor(
  payload: ContextPayload,
  input: {
    injuries: Pick<InjuryReport, "playerId" | "status" | "returnDate">[];
    lineups: LineupEntry[] | null;
    /** Players with ESPN's fantasy status (when there's no injury-feed entry). */
    players: Pick<RosterPlayer, "id" | "injuryStatus">[];
    today: number;
  },
): (player: number) => number | null {
  const reports = new Map(input.injuries.map((i) => [i.playerId, i]));
  const status = new Map(input.players.map((p) => [p.id, p.injuryStatus]));
  const regs = Object.entries(payload.regulars).flatMap(([team, rs]) =>
    rs.map((r) => ({ id: r.player, name: r.name, team: PRO_TEAM_BY_ID[Number(team)] ?? "" })),
  );
  const match = buildMatcher(regs);
  const inactive = new Set<number>();
  for (const e of input.lineups ?? [])
    if (e.rosterStatus === "Inactive") {
      const id = match(e.name, toEspnTeam(e.team));
      if (id != null) inactive.add(id);
    }
  return (id) => {
    const a = absenceOf({ id, injuryStatus: status.get(id) ?? null }, reports.get(id), input.today);
    if (a) return a.season ? Infinity : a.outUntil;
    return inactive.has(id) ? input.today + 1 : null;
  };
}

/** Players with their context attached (none without a stored context). */
export function withContext<T extends RosterPlayer>(
  players: T[],
  payload: ContextPayload | null,
  outUntil: (player: number) => number | null,
  today: number,
): T[] {
  if (!payload) return players;
  return players.map((p) => {
    const adj = payload.adj[p.id] ?? [];
    const days = factorDays(p.id, groupOf(p), payload.regulars[p.proTeamId] ?? [], outUntil, today);
    return adj.length || days.some((d) => d.factor !== 1) ? { ...p, context: { adj, days } } : p;
  });
}
