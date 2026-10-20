// Trade evaluation. A team's value is its projected starting-lineup points for the rest of
// the season: for every remaining day, the best lineup from the players with a game (each
// worth fppg x his share of games played). Regular season and playoff weeks are kept apart,
// because playoff weeks decide the title. Whether the partner would accept is a separate
// question, answered with market value (lib/nba/market.ts). Uneven trades (2-for-1 etc.)
// make both sides balance their rosters: drop their least valuable players or add the best
// free agents. The season simulator then checks the deal Jack picks.

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import {
  expandSlots,
  greedyStarters,
  isStartingSlot,
  type Position,
} from "@fantasy-copilot/fantasy-core";
import { matchupPeriodOf } from "./calendar";
import { acceptance, marketValue, type Acceptance, type MarketContext } from "./market";
import { perGameProjection } from "./projection";

export interface ValueContext {
  /** proTeamId -> days with a game, from `fromDay` to `lastDay`. */
  gameDays: Map<number, Set<number>>;
  slotCounts: Record<string, number>;
  fromDay: number;
  lastDay: number;
  regularWeeks: number;
  /** Starting slots, expanded (PG, SG, ..., UTIL, UTIL). */
  openSlots: string[];
  /** Active roster size (every slot but IR). */
  rosterLimit: number;
}

export function valueContext(
  games: ProGame[],
  slotCounts: Record<string, number>,
  fromDay: number,
  lastDay: number,
  regularWeeks: number,
): ValueContext {
  const gameDays = new Map<number, Set<number>>();
  for (const g of games) {
    if (g.scoringPeriodId < fromDay || g.scoringPeriodId > lastDay) continue;
    for (const t of [g.homeProTeamId, g.awayProTeamId]) {
      if (!gameDays.has(t)) gameDays.set(t, new Set());
      gameDays.get(t)!.add(g.scoringPeriodId);
    }
  }
  const openSlots = expandSlots(slotCounts).filter(isStartingSlot);
  const rosterLimit = Object.entries(slotCounts)
    .filter(([slot]) => slot !== "IR")
    .reduce((a, [, n]) => a + n, 0);
  return { gameDays, slotCounts, fromDay, lastDay, regularWeeks, openSlots, rosterLimit };
}

/** Expected points per game he plays, discounted for the games he's projected to miss. */
export function perGameValue(p: RosterPlayer): number {
  const proj = p.projection;
  const gp = proj?.avg && proj.total ? proj.total / proj.avg : 70;
  return perGameProjection(p).fppg * Math.min(1, gp / 82);
}

export interface TeamValue {
  regular: number;
  playoffs: number;
}

export function teamValue(roster: RosterPlayer[], ctx: ValueContext): TeamValue {
  const players = roster
    .filter((p) => p.slot !== "IR" || perGameValue(p) > 0)
    .map((p) => ({ p, v: perGameValue(p) }));
  // Many days have the same set of players playing: solve each set once.
  const memo = new Map<string, number>();
  let regular = 0;
  let playoffs = 0;
  for (let day = ctx.fromDay; day <= ctx.lastDay; day++) {
    const playing = players.filter(({ p }) => ctx.gameDays.get(p.proTeamId)?.has(day));
    if (!playing.length) continue;
    const key = playing.map(({ p }) => p.id).join(",");
    let pts = memo.get(key);
    if (pts === undefined) {
      pts = greedyStarters(
        playing,
        (x) => x.v,
        (x) => x.p.positions as Position[],
        ctx.openSlots,
      ).reduce((a, x) => a + x.v, 0);
      memo.set(key, pts);
    }
    if (matchupPeriodOf(day) > ctx.regularWeeks) playoffs += pts;
    else regular += pts;
  }
  return { regular, playoffs };
}

/** Raw rest-of-season points (no lineup limits): how most managers size up a deal. */
export function rawValue(players: RosterPlayer[], ctx: ValueContext): number {
  return players.reduce(
    (a, p) => a + perGameValue(p) * (ctx.gameDays.get(p.proTeamId)?.size ?? 0),
    0,
  );
}

export interface TradeSide {
  teamId: number;
  roster: RosterPlayer[];
}

export interface RosterMoves {
  /** Players cut to make room (the side receiving more players). */
  dropped: RosterPlayer[];
  /** Free agents added to fill open spots (the side receiving fewer). */
  added: RosterPlayer[];
}

/**
 * The roster after a trade: players out, players in, then back to the active roster limit by
 * dropping the lowest rest-of-season values or adding the best free agents not yet `taken`.
 */
export function applyTrade(
  roster: RosterPlayer[],
  out: RosterPlayer[],
  incoming: RosterPlayer[],
  ctx: ValueContext,
  freeAgents: RosterPlayer[] = [],
  taken: Set<number> = new Set(),
): { roster: RosterPlayer[]; moves: RosterMoves } {
  const outIds = new Set(out.map((p) => p.id));
  let next = [
    ...roster.filter((p) => !outIds.has(p.id)),
    ...incoming.map((p) => ({ ...p, slot: "BE" })),
  ];
  const moves: RosterMoves = { dropped: [], added: [] };
  const active = () => next.filter((p) => p.slot !== "IR");
  while (active().length > ctx.rosterLimit) {
    const worst = active().sort((a, b) => rawValue([a], ctx) - rawValue([b], ctx))[0]!;
    moves.dropped.push(worst);
    next = next.filter((p) => p.id !== worst.id);
  }
  const best = freeAgents
    .filter((f) => !taken.has(f.id) && !next.some((p) => p.id === f.id))
    .sort((a, b) => rawValue([b], ctx) - rawValue([a], ctx));
  while (active().length < ctx.rosterLimit && best.length) {
    const fa = best.shift()!;
    taken.add(fa.id);
    moves.added.push(fa);
    next.push({ ...fa, slot: "BE" });
  }
  return { roster: next, moves };
}

export interface TradeEval {
  give: RosterPlayer[];
  get: RosterPlayer[];
  /** Change in projected starting points for Jack's team and the partner. */
  mine: { regular: number; playoffs: number };
  theirs: { regular: number; playoffs: number };
  /** Raw rest-of-season points Jack receives minus what he sends. */
  rawGap: number;
  /** Roster moves each side has to make for an uneven trade. */
  moves: { mine: RosterMoves; theirs: RosterMoves };
  /** Would the partner accept, by market value (when a market context is given). */
  acceptance: Acceptance | null;
}

export interface EvalOptions {
  base?: { mine: TeamValue; theirs: TeamValue };
  freeAgents?: RosterPlayer[];
  market?: MarketContext;
}

export function evaluateTrade(
  me: TradeSide,
  them: TradeSide,
  give: RosterPlayer[],
  get: RosterPlayer[],
  ctx: ValueContext,
  { base, freeAgents = [], market }: EvalOptions = {},
): TradeEval {
  const mineBefore = base?.mine ?? teamValue(me.roster, ctx);
  const theirsBefore = base?.theirs ?? teamValue(them.roster, ctx);
  const taken = new Set<number>();
  const mineNext = applyTrade(me.roster, give, get, ctx, freeAgents, taken);
  const theirsNext = applyTrade(them.roster, get, give, ctx, freeAgents, taken);
  const mineAfter = teamValue(mineNext.roster, ctx);
  const theirsAfter = teamValue(theirsNext.roster, ctx);
  const theirs = {
    regular: theirsAfter.regular - theirsBefore.regular,
    playoffs: theirsAfter.playoffs - theirsBefore.playoffs,
  };
  return {
    give,
    get,
    mine: {
      regular: mineAfter.regular - mineBefore.regular,
      playoffs: mineAfter.playoffs - mineBefore.playoffs,
    },
    theirs,
    rawGap: rawValue(get, ctx) - rawValue(give, ctx),
    moves: { mine: mineNext.moves, theirs: theirsNext.moves },
    acceptance: market ? acceptance(get, give, theirs.regular + theirs.playoffs, market) : null,
  };
}

export interface TradeIdea extends TradeEval {
  partnerId: number;
  /** Ranking score: regular-season starting points plus playoff-week points counted twice. */
  score: number;
}

/** Playoff weeks decide the title, so a playoff-week point counts double in the ranking. */
export const PLAYOFF_WEIGHT = 2;

export const tradeSize = (e: { give: unknown[]; get: unknown[] }) =>
  `${e.give.length}-for-${e.get.length}`;

/** Every subset of `items` with 1..maxSize members. */
function subsets<T>(items: T[], maxSize: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, cur: T[]) => {
    if (cur.length) out.push(cur);
    if (cur.length === maxSize) return;
    for (let i = start; i < items.length; i++) walk(i + 1, [...cur, items[i]!]);
  };
  walk(0, []);
  return out;
}

export interface TargetOptions {
  /** Ideas kept for each trade size (1-for-1, 2-for-1, ...). */
  perSize?: number;
  /** Players per side, up to 3 (3-for-3). */
  maxSize?: number;
  /** Players considered on each roster: the most valuable by market. */
  pool?: number;
  /** Candidate deals per partner and trade size that get the full two-team evaluation. */
  exactPerSize?: number;
}

/** Players this cheap (market $) are throw-ins: deals that differ only by them are the same deal. */
const FILLER_DOLLARS = 3;
/** Most market value Jack sends relative to what he gets back. */
const MAX_OVERPAY = 1.25;
/** Ideas per trade size built around the same outgoing star, so one player can't fill the list. */
const PER_STAR = 2;

/**
 * Trades up to 3-for-3 that raise Jack's starting points and that the partner would plausibly
 * accept by market value (realism "likely" or "fair").
 *
 * Search: the top `pool` players on each roster by market value; every pair of subsets whose
 * market values could pass the partner's check; ranked by a quick estimate (each player's
 * marginal lineup value to the team he'd join or leave); the best `exactPerSize` per size and
 * partner get the exact evaluation with roster balancing.
 */
export function findTradeTargets(
  me: TradeSide,
  others: TradeSide[],
  ctx: ValueContext,
  market: MarketContext,
  freeAgents: RosterPlayer[] = [],
  { perSize = 8, maxSize = 3, pool = 10, exactPerSize = 40 }: TargetOptions = {},
): TradeIdea[] {
  const $ = new Map<number, number>();
  const dollars = (p: RosterPlayer) => {
    if (!$.has(p.id)) $.set(p.id, marketValue(p, market));
    return $.get(p.id)!;
  };
  const sumDollars = (ps: RosterPlayer[]) => ps.reduce((a, p) => a + dollars(p), 0);
  const weighted = (v: TeamValue) => v.regular + PLAYOFF_WEIGHT * v.playoffs;
  const tradeable = (r: RosterPlayer[]) =>
    r
      .filter((p) => !p.tradeLocked)
      .sort((a, b) => dollars(b) - dollars(a))
      .slice(0, pool);

  const mineBase = teamValue(me.roster, ctx);
  // Each of Jack's players: what losing him costs the lineup.
  const myLoss = new Map(
    tradeable(me.roster).map((p) => [
      p.id,
      weighted(mineBase) -
        weighted(
          teamValue(
            me.roster.filter((x) => x.id !== p.id),
            ctx,
          ),
        ),
    ]),
  );
  const mySets = subsets(tradeable(me.roster), maxSize).map((g) => ({
    players: g,
    $: sumDollars(g),
    loss: g.reduce((a, p) => a + myLoss.get(p.id)!, 0),
  }));

  const ideas: TradeIdea[] = [];
  for (const other of others) {
    const theirsBase = teamValue(other.roster, ctx);
    const theirPool = tradeable(other.roster);
    // Each of their players: what he'd add to Jack's lineup.
    const myGain = new Map(
      theirPool.map((p) => [
        p.id,
        weighted(teamValue([...me.roster, { ...p, slot: "BE" }], ctx)) - weighted(mineBase),
      ]),
    );
    // Candidates by trade size, so lopsided-count deals don't crowd out 1-for-1s and 2-for-2s.
    const bySize = new Map<
      string,
      { give: RosterPlayer[]; get: RosterPlayer[]; approx: number }[]
    >();
    for (const getSet of subsets(theirPool, maxSize)) {
      const getDollars = sumDollars(getSet);
      const gain = getSet.reduce((a, p) => a + myGain.get(p.id)!, 0);
      for (const g of mySets) {
        // The partner wants at least ~even market value. Jack gives up at most ~25% more than
        // he gets: lineup points say what wins, but when the market and the projection
        // disagree this much, the projection may be the one that's wrong.
        if (g.$ < 0.95 * getDollars || g.$ > MAX_OVERPAY * getDollars + 2) continue;
        const approx = gain - g.loss;
        if (approx <= 0) continue;
        const size = `${g.players.length}-for-${getSet.length}`;
        if (!bySize.has(size)) bySize.set(size, []);
        bySize.get(size)!.push({ give: g.players, get: getSet, approx });
      }
    }
    for (const list of bySize.values()) {
      list.sort((a, b) => b.approx - a.approx);
      for (const c of list.slice(0, exactPerSize)) {
        const e = evaluateTrade(me, other, c.give, c.get, ctx, {
          base: { mine: mineBase, theirs: theirsBase },
          freeAgents,
          market,
        });
        if (!e.acceptance || e.acceptance.realism === "long shot") continue;
        // A player someone would cut right after receiving him adds nothing to the deal.
        const cut = (m: RosterMoves, got: RosterPlayer[]) =>
          m.dropped.some((d) => got.some((p) => p.id === d.id));
        if (cut(e.moves.mine, c.get) || cut(e.moves.theirs, c.give)) continue;
        const score = e.mine.regular + PLAYOFF_WEIGHT * e.mine.playoffs;
        if (score > 1) ideas.push({ ...e, partnerId: other.teamId, score });
      }
    }
  }
  // Same deal with different throw-ins: keep the best version.
  const core = (i: TradeIdea) =>
    [
      i.partnerId,
      ...[...i.give, ...i.get]
        .filter((p) => dollars(p) >= FILLER_DOLLARS)
        .map((p) => p.id)
        .sort(),
    ].join(",");
  ideas.sort((x, y) => y.score - x.score);
  const seen = new Set<string>();
  const unique = ideas.filter((i) => !seen.has(core(i)) && seen.add(core(i)));
  const kept = new Map<string, number>();
  const star = (i: TradeIdea) => [...i.give].sort((a, b) => dollars(b) - dollars(a))[0]!.id;
  return unique.filter((i) => {
    const size = tradeSize(i);
    const n = kept.get(size) ?? 0;
    const s = `${size}:${star(i)}`;
    const m = kept.get(s) ?? 0;
    if (n >= perSize || m >= PER_STAR) return false;
    kept.set(size, n + 1);
    kept.set(s, m + 1);
    return true;
  });
}
