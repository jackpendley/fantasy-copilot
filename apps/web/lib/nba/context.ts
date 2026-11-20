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
import type { OutTeammate, PlayerContext, SkippedTeammate } from "./context-factor";
import { groupOf } from "./teammate-return";

export {
  factorOn,
  type OutTeammate,
  type PlayerContext,
  type SkippedTeammate,
} from "./context-factor";

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

/**
 * A regular who is out: until the day he's expected back (a scoring period, Infinity for the
 * season), what says so today, and ESPN's estimated return date.
 */
export interface OutStatus {
  until: number;
  source: OutTeammate["source"];
  back: string | null;
}

/**
 * A player's factor from each day on (from `today`): his team's regulars who are out, each
 * until the day he's expected back (`outUntil`: null when he plays). Consecutive days with the
 * same factor merge. Each day names the regulars who count, with what says they're out: today's
 * source (NBA.com, the official report or ESPN) today, ESPN's estimate after. Pure.
 */
export function factorDays(
  player: number,
  group: string | null,
  regulars: readonly (Regular & { name: string })[],
  outUntil: (player: number) => OutStatus | null,
  today: number,
): PlayerContext["days"] {
  const out = regulars
    .filter((r) => r.player !== player)
    .map((r) => ({ r, o: outUntil(r.player) }))
    .filter(
      (x): x is { r: Regular & { name: string }; o: OutStatus } => x.o != null && x.o.until > today,
    );
  const days: PlayerContext["days"] = [];
  const breaks = [
    today,
    ...new Set(out.map((x) => x.o.until).filter((d) => Number.isFinite(d))),
  ].sort((a, b) => a - b);
  for (const day of breaks) {
    const now = out.filter((x) => x.o.until > day);
    const factor = contextFactor(
      now.map((x) => ({ share: x.r.share, idx: 1, group: x.r.group, min10: x.r.min10 })),
      group,
    );
    const names = now
      .filter((x) => counts(x.r))
      .map((x) => ({
        name: x.r.name,
        source: day === today ? x.o.source : ("ESPN" as const),
        back: x.o.back,
      }));
    if (days.at(-1)?.factor !== factor) days.push({ day, factor, out: names });
  }
  return days;
}

/** A regular whose absence moves his teammates' factor. */
const counts = (r: Pick<Regular, "min10" | "share">) => r.min10 >= REGULAR_MIN && r.share > FLOOR;

/** A player who played for a team this season but isn't one of its regulars now. */
export interface Other {
  player: number;
  games: number;
  min10: number;
}

/**
 * Each team's other players as of `now`: their latest game was for it, but they have fewer than
 * 5 games or under 10 minutes a game over their last 10 (for the card's "not counted" note).
 */
export function othersNow(
  logs: ReadonlyMap<number, readonly Appearance[]>,
  regulars: ReadonlyMap<string, readonly Regular[]>,
  now: number,
): Map<string, Other[]> {
  const isRegular = new Set([...regulars.values()].flat().map((r) => r.player));
  const out = new Map<string, Other[]>();
  for (const [id, gs] of logs) {
    const before = gs.filter((g) => g.t < now);
    const team = before.at(-1)?.team;
    if (!team || isRegular.has(id)) continue;
    const list = out.get(team) ?? [];
    list.push({
      player: id,
      games: before.length,
      min10: mean(before.slice(-LAST).map((g) => g.min)),
    });
    out.set(team, list);
  }
  return out;
}

/**
 * Teammates listed out today who don't move his factor, and why: a regular under 20 minutes a
 * game or with 10% or less of the team's points, or a player ESPN rules out who isn't a regular
 * (fewer than 5 games this season, under 10 minutes a game, or no game for the team yet). Pure.
 */
export function skippedToday(
  player: number,
  team: string,
  payload: Pick<ContextPayload, "regulars" | "others">,
  outUntil: (player: number) => OutStatus | null,
  listedOut: readonly Pick<InjuryReport, "playerId" | "name" | "teamId">[],
  today: number,
): SkippedTeammate[] {
  const regulars = payload.regulars[team] ?? [];
  const skipped: SkippedTeammate[] = [];
  for (const r of regulars) {
    if (r.player === player || counts(r) || !((outUntil(r.player)?.until ?? 0) > today)) continue;
    skipped.push({
      name: r.name,
      reason:
        r.min10 < REGULAR_MIN
          ? `${Math.round(r.min10)} min a game over his last 10; needs ${REGULAR_MIN}`
          : `${Math.round(r.share * 100)}% of the team's points; needs over ${FLOOR * 100}%`,
    });
  }
  const isRegular = new Set(regulars.map((r) => r.player));
  const others = new Map((payload.others?.[team] ?? []).map((o) => [o.player, o]));
  for (const i of listedOut) {
    if (i.playerId === player || String(i.teamId) !== team || isRegular.has(i.playerId)) continue;
    const o = others.get(i.playerId);
    skipped.push({
      name: i.name,
      reason: !payload.others
        ? `not a regular yet (${MIN_GAMES}+ games and ${ROTATION_MIN}+ min a game needed)`
        : !o
          ? "no game for his team this season"
          : o.games < MIN_GAMES
            ? `${o.games} game${o.games === 1 ? "" : "s"} this season; needs ${MIN_GAMES}`
            : `${Math.round(o.min10)} min a game over his last 10; needs ${ROTATION_MIN}`,
    });
  }
  return skipped;
}

/** What the nightly step stores (lib/nba/context-run.ts). */
export interface ContextPayload {
  /** The scoring period it was computed for (games before it count). */
  asOf: number;
  /** Per player id: his games with a factor above 1 ([game id, scoring period, factor, FP, minutes]). */
  adj: Record<string, PlayerContext["adj"]>;
  /** Per pro team id: its regulars now, with names to match NBA.com's lineups. */
  regulars: Record<string, (Regular & { name: string })[]>;
  /** Per pro team id: its other players this season (stored from Nov 20; absent before). */
  others?: Record<string, Other[]>;
}

/**
 * Whether each regular is out, until when (scoring period; Infinity for the season) and on
 * whose word, strongest first as the Today board (lib/nba/active.ts): NBA.com listing him
 * inactive today, the official report's Out today, then an ESPN absence (ruled out, with its
 * estimated return). Today's sources carry him to tomorrow at least; ESPN's estimate beyond.
 * Null when he plays. Pure.
 */
export function outUntilFor(
  payload: ContextPayload,
  input: {
    injuries: Pick<InjuryReport, "playerId" | "status" | "returnDate">[];
    lineups: LineupEntry[] | null;
    /** Players the official report lists Out today (ESPN ids). */
    officialOut?: ReadonlySet<number>;
    /** Players with ESPN's fantasy status (when there's no injury-feed entry). */
    players: Pick<RosterPlayer, "id" | "injuryStatus">[];
    today: number;
  },
): (player: number) => OutStatus | null {
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
    const espn = a ? (a.season ? Infinity : a.outUntil) : null;
    const back = a?.returnDate ?? null;
    const tonight = (source: OutStatus["source"]) => ({
      until: Math.max(espn ?? 0, input.today + 1),
      source,
      back,
    });
    if (inactive.has(id)) return tonight("NBA.com");
    if (input.officialOut?.has(id)) return tonight("official report");
    return espn != null ? { until: espn, source: "ESPN", back } : null;
  };
}

/**
 * Players with their context attached (none without a stored context). `listedOut`: ESPN's
 * injury feed, for the teammates it rules out who don't count.
 */
export function withContext<T extends RosterPlayer>(
  players: T[],
  payload: ContextPayload | null,
  outUntil: (player: number) => OutStatus | null,
  today: number,
  listedOut: Pick<InjuryReport, "playerId" | "name" | "teamId" | "status" | "returnDate">[] = [],
): T[] {
  if (!payload) return players;
  const ruledOut = listedOut.filter((i) =>
    absenceOf({ id: i.playerId, injuryStatus: null }, i, today),
  );
  return players.map((p) => {
    const adj = payload.adj[p.id] ?? [];
    const team = String(p.proTeamId);
    const days = factorDays(p.id, groupOf(p), payload.regulars[team] ?? [], outUntil, today);
    const skipped = skippedToday(p.id, team, payload, outUntil, ruledOut, today);
    return adj.length || days.some((d) => d.factor !== 1) || skipped.length
      ? { ...p, context: { adj, days, ...(skipped.length ? { skipped } : {}) } }
      : p;
  });
}
