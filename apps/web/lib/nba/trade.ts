// Trade evaluation. A team's value is its projected starting-lineup points for the rest of
// the season: for every remaining day, the best lineup from the players with a game (each
// worth fppg x his share of games played). Regular season and playoff weeks are kept apart,
// because playoff weeks decide the title. Whether the partner would accept is a separate
// question, answered with market value (lib/nba/market.ts). Uneven trades (2-for-1 etc.)
// make both sides balance their rosters: drop the players their lineup misses least, or add
// the best free agents. An incoming player who's ruled out goes to an open IL slot instead of
// costing a roster spot. The season simulator then checks the deal Jack picks.

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import {
  expandSlots,
  greedyStarters,
  irEligible,
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
  /** IR slots: ruled-out players there don't take an active spot. */
  irSlots: number;
  /** Injured players: the first day each can play again (lib/nba/availability.ts). */
  outUntil: Map<number, number>;
}

export function valueContext(
  games: ProGame[],
  slotCounts: Record<string, number>,
  fromDay: number,
  lastDay: number,
  regularWeeks: number,
  /** Current absences (absences() in availability.ts); none if omitted. */
  injured: Map<number, { outUntil: number }> = new Map(),
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
  return {
    gameDays,
    slotCounts,
    fromDay,
    lastDay,
    regularWeeks,
    openSlots,
    rosterLimit,
    irSlots: slotCounts.IR ?? 0,
    outUntil: new Map([...injured].map(([id, a]) => [id, a.outUntil])),
  };
}

// Copies of a player ({ ...p, slot }) share his stat objects, so cache on those.
const perGameCache = new WeakMap<object, number>();

/** Expected points per game he plays, discounted for the games he's projected to miss. */
export function perGameValue(p: RosterPlayer): number {
  const key = p.games ?? p.season ?? p.projection;
  const hit = key && perGameCache.get(key);
  if (hit !== undefined && hit !== null) return hit;
  const proj = p.projection;
  const gp = proj?.avg && proj.total ? proj.total / proj.avg : 70;
  const v = perGameProjection(p).fppg * Math.min(1, gp / 82);
  if (key) perGameCache.set(key, v);
  return v;
}

export interface TeamValue {
  regular: number;
  playoffs: number;
  /** Players coming back from the IR slot, and whom the team drops to make room. */
  activations: Activation[];
}

export interface Activation {
  player: RosterPlayer;
  /** First day he plays again. */
  day: number;
  /** Cut to make room (null when there was an open spot). */
  drop: RosterPlayer | null;
}

/**
 * Projected starting-lineup points for the rest of the season. Injured players count from
 * their estimated return (`ctx.outUntil`). A player returning from the IR slot needs an
 * active spot: when the roster is full, the team drops whoever would add the fewest lineup
 * points from that day on (the same rule for every team).
 */
export function teamValue(roster: RosterPlayer[], ctx: ValueContext): TeamValue {
  const players = roster
    .map((p) => ({ p, v: perGameValue(p) }))
    .filter((x) => x.v > 0 || x.p.slot !== "IR");
  const first = players.map(({ p }) =>
    Math.max(ctx.fromDay, ctx.outUntil.get(p.id) ?? ctx.fromDay),
  );
  const last = players.map(() => ctx.lastDay);
  // Who's available each day, as a bitmask over roster indices (rosters stay well under 31).
  const mask = new Array<number>(ctx.lastDay + 1).fill(0);
  players.forEach(({ p }, i) => {
    for (const d of ctx.gameDays.get(p.proTeamId) ?? []) if (d >= first[i]!) mask[d]! |= 1 << i;
  });
  // The day's starters (exact greedy), solved once per set of players.
  const memo = new Map<number, number[]>();
  const starters = (mask: number) => {
    let s = memo.get(mask);
    if (!s) {
      const playing: number[] = [];
      for (let i = 0; i < players.length; i++) if (mask & (1 << i)) playing.push(i);
      s = greedyStarters(
        playing,
        (i) => players[i]!.v,
        (i) => players[i]!.p.positions as Position[],
        ctx.openSlots,
      );
      memo.set(mask, s);
    }
    return s;
  };
  const playoffDay = (day: number) => matchupPeriodOf(day) > ctx.regularWeeks;

  const activations: Activation[] = [];
  let active = roster.filter((p) => p.slot !== "IR").length;
  const returning = players
    .map((x, i) => ({ ...x, i }))
    .filter(({ p, i }) => p.slot === "IR" && first[i]! <= ctx.lastDay)
    .sort((a, b) => first[a.i]! - first[b.i]!);
  for (const { p, i } of returning) {
    const day = first[i]!;
    if (++active <= ctx.rosterLimit) {
      activations.push({ player: p, day, drop: null });
      continue;
    }
    // Lineup points each player would add from his return on; the fewest goes. A player out
    // for the rest of the season adds nothing: he's the natural cut.
    const pts = new Array<number>(players.length).fill(0);
    for (let d = day; d <= ctx.lastDay; d++) {
      if (!mask[d]) continue;
      const w = playoffDay(d) ? PLAYOFF_WEIGHT : 1;
      for (const k of starters(mask[d]!)) pts[k]! += w * players[k]!.v;
    }
    const pool = players
      .map((x, k) => ({ ...x, k }))
      .filter(({ p: x, k }) => x.slot !== "IR" && last[k] === ctx.lastDay);
    const drop = pool.sort((a, b) => pts[a.k]! - pts[b.k]! || a.v - b.v)[0];
    if (drop) {
      last[drop.k] = day - 1;
      for (let d = day; d <= ctx.lastDay; d++) mask[d]! &= ~(1 << drop.k);
      active--;
    }
    activations.push({ player: p, day, drop: drop?.p ?? null });
  }

  let regular = 0;
  let playoffs = 0;
  for (let day = ctx.fromDay; day <= ctx.lastDay; day++) {
    if (!mask[day]) continue;
    let pts = 0;
    for (const k of starters(mask[day]!)) pts += players[k]!.v;
    if (playoffDay(day)) playoffs += pts;
    else regular += pts;
  }
  return { regular, playoffs, activations };
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
  /** Incoming players who are ruled out and go straight to an open IL slot. */
  toIL: RosterPlayer[];
}

/** Playoff weeks decide the title, so a playoff-week point counts double in the ranking. */
export const PLAYOFF_WEIGHT = 2;

export const weighted = (v: TeamValue) => v.regular + PLAYOFF_WEIGHT * v.playoffs;

/**
 * What each player is worth to his own team's lineup: the weighted starting points it loses
 * without him. A team cuts the player it would miss least, which on a deep roster can be a
 * good player stuck behind better ones at his positions.
 */
export function marginalValues(roster: RosterPlayer[], ctx: ValueContext): Map<number, number> {
  const base = weighted(teamValue(roster, ctx));
  return new Map(
    roster.map((p) => [
      p.id,
      base -
        weighted(
          teamValue(
            roster.filter((x) => x.id !== p.id),
            ctx,
          ),
        ),
    ]),
  );
}

/**
 * The roster after a trade: players out, players in, then back to the active roster limit.
 * - An incoming player who's ruled out (IR-eligible) takes a free IR slot, not an active spot.
 * - Over the limit: drop the players the lineup misses least. `"exact"` measures that on the
 *   roster after the trade (one lineup valuation per candidate); a map (marginalValues of
 *   the roster before the trade) is the fast approximation used while searching; without
 *   either, raw rest-of-season points. Never a player just received, never one on IR.
 * - Under it: add the best free agents not yet `taken` (by the other side of the deal).
 */
export function applyTrade(
  roster: RosterPlayer[],
  out: RosterPlayer[],
  incoming: RosterPlayer[],
  ctx: ValueContext,
  freeAgents: RosterPlayer[] = [],
  taken: Set<number> = new Set(),
  marginal?: Map<number, number> | "exact",
): { roster: RosterPlayer[]; moves: RosterMoves } {
  const outIds = new Set(out.map((p) => p.id));
  const moves: RosterMoves = { dropped: [], added: [], toIL: [] };
  let next = roster.filter((p) => !outIds.has(p.id));
  let irFree = ctx.irSlots - next.filter((p) => p.slot === "IR").length;
  for (const p of incoming) {
    const toIL = irFree > 0 && irEligible(p.injuryStatus);
    if (toIL) {
      irFree--;
      moves.toIL.push(p);
    }
    next.push({ ...p, slot: toIL ? "IR" : "BE" });
  }
  const incomingIds = new Set(incoming.map((p) => p.id));
  const active = () => next.filter((p) => p.slot !== "IR");
  while (active().length > ctx.rosterLimit) {
    const cuttable = active().filter((p) => !incomingIds.has(p.id));
    // Only received players left to cut: the deal can't fit this roster as is.
    if (!cuttable.length) break;
    let keepValue: (p: RosterPlayer) => number;
    if (marginal === "exact") {
      const without = new Map(
        cuttable.map((p) => [
          p.id,
          weighted(
            teamValue(
              next.filter((x) => x.id !== p.id),
              ctx,
            ),
          ),
        ]),
      );
      // Cutting him leaves the most: he's the one the lineup misses least. On a tie (a bench
      // player either way), cut the one with fewer raw rest-of-season points.
      keepValue = (p) => -without.get(p.id)! + rawValue([p], ctx) * 1e-6;
    } else {
      keepValue = (p) => marginal?.get(p.id) ?? rawValue([p], ctx);
    }
    const worst = cuttable.sort((a, b) => keepValue(a) - keepValue(b))[0]!;
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
  /** Both rosters fit after the deal (false if a side would have to cut a player it just got). */
  fits: boolean;
}

export interface EvalOptions {
  base?: { mine: TeamValue; theirs: TeamValue };
  freeAgents?: RosterPlayer[];
  market?: MarketContext;
  /**
   * How each side picks its cuts (applyTrade): marginalValues maps for speed while searching;
   * by default, exactly on the roster after the trade.
   */
  marginal?: { mine: Map<number, number>; theirs: Map<number, number> };
}

export function evaluateTrade(
  me: TradeSide,
  them: TradeSide,
  give: RosterPlayer[],
  get: RosterPlayer[],
  ctx: ValueContext,
  { base, freeAgents = [], market, marginal }: EvalOptions = {},
): TradeEval {
  const mineBefore = base?.mine ?? teamValue(me.roster, ctx);
  const theirsBefore = base?.theirs ?? teamValue(them.roster, ctx);
  const mineMarginal = marginal?.mine ?? "exact";
  const theirsMarginal = marginal?.theirs ?? "exact";
  const taken = new Set<number>();
  const mineNext = applyTrade(me.roster, give, get, ctx, freeAgents, taken, mineMarginal);
  const theirsNext = applyTrade(them.roster, get, give, ctx, freeAgents, taken, theirsMarginal);
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
    fits: [mineNext.roster, theirsNext.roster].every(
      (r) => r.filter((p) => p.slot !== "IR").length <= ctx.rosterLimit,
    ),
  };
}

export interface TradeIdea extends TradeEval {
  partnerId: number;
  /** Ranking score: regular-season starting points plus playoff-week points counted twice. */
  score: number;
}

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
 * marginal lineup value to the team he'd join or leave, plus the free agents Jack would pick
 * up or minus the players he'd cut when the counts differ); the best `exactPerSize` (20: the same top 20 ideas as 40 on the live league, in two-thirds the time) per size
 * and partner get the exact evaluation with roster balancing.
 */
export function findTradeTargets(
  me: TradeSide,
  others: TradeSide[],
  ctx: ValueContext,
  market: MarketContext,
  freeAgents: RosterPlayer[] = [],
  { perSize = 8, maxSize = 3, pool = 10, exactPerSize = 20 }: TargetOptions = {},
): TradeIdea[] {
  const $ = new Map<number, number>();
  const dollars = (p: RosterPlayer) => {
    if (!$.has(p.id)) $.set(p.id, marketValue(p, market));
    return $.get(p.id)!;
  };
  const sumDollars = (ps: RosterPlayer[]) => ps.reduce((a, p) => a + dollars(p), 0);
  const tradeable = (r: RosterPlayer[]) =>
    r
      .filter((p) => !p.tradeLocked)
      .sort((a, b) => dollars(b) - dollars(a))
      .slice(0, pool);

  const mineBase = teamValue(me.roster, ctx);
  // Each of Jack's players: what losing him costs the lineup (and who he'd cut first).
  const myMarginal = marginalValues(me.roster, ctx);
  const mySets = subsets(tradeable(me.roster), maxSize).map((g) => ({
    players: g,
    $: sumDollars(g),
    loss: g.reduce((a, p) => a + myMarginal.get(p.id)!, 0),
  }));
  // Receiving more than he sends: Jack cuts the players he'd miss least (not ones he's
  // trading away, not his IR slot).
  const cutOrder = me.roster
    .filter((p) => p.slot !== "IR")
    .sort((a, b) => myMarginal.get(a.id)! - myMarginal.get(b.id)!);
  const cutCost = (k: number, give: RosterPlayer[]) => {
    let cost = 0;
    let cut = 0;
    for (const p of cutOrder) {
      if (cut === k) break;
      if (give.some((g) => g.id === p.id)) continue;
      cost += Math.max(0, myMarginal.get(p.id)!);
      cut++;
    }
    return cost;
  };
  // Sending more than he receives: Jack fills the open spots with the best free agents.
  // fill[k] = what the best k free agents add to his lineup.
  const fill = [0];
  {
    const best = [...freeAgents].sort((a, b) => rawValue([b], ctx) - rawValue([a], ctx));
    let roster = me.roster;
    for (let k = 1; k < maxSize; k++) {
      const fa = best[k - 1];
      if (fa) roster = [...roster, { ...fa, slot: "BE" }];
      fill.push(weighted(teamValue(roster, ctx)) - weighted(mineBase));
    }
  }

  const ideas: TradeIdea[] = [];
  for (const other of others) {
    const theirsBase = teamValue(other.roster, ctx);
    const theirMarginal = marginalValues(other.roster, ctx);
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
        const net = g.players.length - getSet.length;
        const approx =
          gain - g.loss + (net > 0 ? fill[net]! : net < 0 ? -cutCost(-net, g.players) : 0);
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
          marginal: { mine: myMarginal, theirs: theirMarginal },
        });
        if (!e.acceptance || e.acceptance.realism === "long shot" || !e.fits) continue;
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
  const firstPass = ideas.filter((i) => !seen.has(core(i)) && seen.add(core(i)));
  // Finalists of uneven deals get the exact cut on the roster after the trade (the search used
  // each player's value to the roster before it, which misses new redundancy).
  const partners = new Map(others.map((o) => [o.teamId, o]));
  const perSizeSeen = new Map<string, number>();
  const unique: TradeIdea[] = [];
  for (const i of firstPass) {
    const size = tradeSize(i);
    const n = perSizeSeen.get(size) ?? 0;
    if (n >= perSize * 3) continue;
    perSizeSeen.set(size, n + 1);
    if (i.give.length === i.get.length) {
      unique.push(i);
      continue;
    }
    const e = evaluateTrade(me, partners.get(i.partnerId)!, i.give, i.get, ctx, {
      base: { mine: mineBase, theirs: teamValue(partners.get(i.partnerId)!.roster, ctx) },
      freeAgents,
      market,
    });
    if (!e.acceptance || e.acceptance.realism === "long shot" || !e.fits) continue;
    const score = e.mine.regular + PLAYOFF_WEIGHT * e.mine.playoffs;
    if (score > 1) unique.push({ ...e, partnerId: i.partnerId, score });
  }
  unique.sort((x, y) => y.score - x.score);
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
