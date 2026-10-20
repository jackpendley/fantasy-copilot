// Trade evaluation. A team's value is its projected starting-lineup points for the rest of
// the season: for every remaining day, the best lineup from the players with a game (each
// worth fppg x his share of games played). Regular season and playoff weeks are kept apart,
// because playoff weeks decide the title. This is deterministic and fast enough to search
// hundreds of trades; the season simulator then checks the one Jack picks.

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { optimizeLineup, type Position } from "@fantasy-copilot/fantasy-core";
import { matchupPeriodOf } from "./calendar";
import { perGameProjection } from "./projection";

export interface ValueContext {
  /** proTeamId -> days with a game, from `fromDay` to `lastDay`. */
  gameDays: Map<number, Set<number>>;
  slotCounts: Record<string, number>;
  fromDay: number;
  lastDay: number;
  regularWeeks: number;
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
  return { gameDays, slotCounts, fromDay, lastDay, regularWeeks };
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
      pts = optimizeLineup(
        playing.map(({ p, v }) => ({
          id: p.id,
          eligible: p.positions as Position[],
          value: v,
          currentSlot: "BE",
        })),
        ctx.slotCounts,
      ).points;
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

export interface TradeEval {
  give: RosterPlayer[];
  get: RosterPlayer[];
  /** Change in projected starting points for Jack's team and the partner. */
  mine: { regular: number; playoffs: number };
  theirs: { regular: number; playoffs: number };
  /** Raw rest-of-season points Jack receives minus what he sends (partner's view of fairness). */
  rawGap: number;
}

const swap = (roster: RosterPlayer[], out: RosterPlayer[], add: RosterPlayer[]) => {
  const ids = new Set(out.map((p) => p.id));
  return [...roster.filter((p) => !ids.has(p.id)), ...add.map((p) => ({ ...p, slot: "BE" }))];
};

export function evaluateTrade(
  me: TradeSide,
  them: TradeSide,
  give: RosterPlayer[],
  get: RosterPlayer[],
  ctx: ValueContext,
  base?: { mine: TeamValue; theirs: TeamValue },
): TradeEval {
  const mineBefore = base?.mine ?? teamValue(me.roster, ctx);
  const theirsBefore = base?.theirs ?? teamValue(them.roster, ctx);
  const mineAfter = teamValue(swap(me.roster, give, get), ctx);
  const theirsAfter = teamValue(swap(them.roster, get, give), ctx);
  return {
    give,
    get,
    mine: {
      regular: mineAfter.regular - mineBefore.regular,
      playoffs: mineAfter.playoffs - mineBefore.playoffs,
    },
    theirs: {
      regular: theirsAfter.regular - theirsBefore.regular,
      playoffs: theirsAfter.playoffs - theirsBefore.playoffs,
    },
    rawGap: rawValue(get, ctx) - rawValue(give, ctx),
  };
}

export interface TradeIdea extends TradeEval {
  partnerId: number;
  /** Ranking score: regular-season starting points plus playoff-week points counted twice. */
  score: number;
}

/** Playoff weeks decide the title, so a playoff-week point counts double in the ranking. */
export const PLAYOFF_WEIGHT = 2;

/**
 * 1-for-1 trades that raise Jack's starting points and that the partner could accept:
 * they get back at least ~95% of the raw value they send, and their own lineup doesn't lose
 * more than `maxPartnerLoss` points.
 */
export function findTradeTargets(
  me: TradeSide,
  others: TradeSide[],
  ctx: ValueContext,
  { max = 10, perPartner = 2, maxPartnerLoss = 50 } = {},
): TradeIdea[] {
  const mineBase = teamValue(me.roster, ctx);
  const raw = new Map<number, number>();
  const rawOf = (p: RosterPlayer) => {
    if (!raw.has(p.id)) raw.set(p.id, rawValue([p], ctx));
    return raw.get(p.id)!;
  };
  const ideas: TradeIdea[] = [];
  for (const other of others) {
    const theirsBase = teamValue(other.roster, ctx);
    const found: TradeIdea[] = [];
    for (const a of me.roster) {
      for (const b of other.roster) {
        if (rawOf(a) < 0.95 * rawOf(b) || rawOf(b) === 0) continue;
        const e = evaluateTrade(me, other, [a], [b], ctx, { mine: mineBase, theirs: theirsBase });
        if (e.theirs.regular + e.theirs.playoffs < -maxPartnerLoss) continue;
        const score = e.mine.regular + PLAYOFF_WEIGHT * e.mine.playoffs;
        if (score > 1) found.push({ ...e, partnerId: other.teamId, score });
      }
    }
    ideas.push(...found.sort((x, y) => y.score - x.score).slice(0, perPartner));
  }
  return ideas.sort((x, y) => y.score - x.score).slice(0, max);
}
