// What other managers think a player is worth, in auction dollars. Trades are judged two
// ways: lineup points (what actually wins, lib/nba/trade.ts) and market value (what a
// manager will accept). A deal is realistic only if the partner gets fair market value.
//
// Preseason value blends ESPN's average auction price, ESPN's own dollar value, and where
// this league actually drafted him. As games accumulate it shifts toward his in-season rank
// (ESPN's, or his fantasy points per game when ESPN hasn't ranked yet). Dollars are convex:
// a $40 star costs far more than two $20 players, which builds in the star premium.

import type { RosterPlayer } from "@fantasy-copilot/espn";

/** Games of in-season data that count as much as the preseason market. */
const SEASON_WEIGHT_GAMES = 20;
/** Value of a replacement-level player (anyone outside the curve). */
export const FLOOR_DOLLARS = 0.5;

export interface MarketContext {
  /** Dollar value of the n-th best player (index n-1), from ESPN average auction prices. */
  curve: number[];
  /** Overall pick in this league's draft. */
  draftPick: Map<number, number>;
  /** In-season rank when ESPN hasn't published one: by fantasy points per game (3+ games). */
  fallbackRank: Map<number, number>;
}

const gamesPlayed = (p: RosterPlayer) =>
  p.season?.avg && p.season.total ? Math.round(p.season.total / p.season.avg) : 0;

export function marketContext(pool: RosterPlayer[], draftPick: Map<number, number>): MarketContext {
  const curve = pool
    .map((p) => p.market?.auctionAvg ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  const ranked = pool
    .filter((p) => gamesPlayed(p) >= 3 && p.season?.avg != null)
    .sort((a, b) => b.season!.avg! - a.season!.avg!);
  return {
    curve,
    draftPick,
    fallbackRank: new Map(ranked.map((p, i) => [p.id, i + 1])),
  };
}

export const dollarsAtRank = (ctx: MarketContext, rank: number) =>
  Math.max(FLOOR_DOLLARS, ctx.curve[rank - 1] ?? FLOOR_DOLLARS);

export function marketValue(p: RosterPlayer, ctx: MarketContext): number {
  const m = p.market;
  const parts: number[] = [];
  if (m?.auctionAvg) parts.push(m.auctionAvg);
  if (m?.espnAuction) parts.push(m.espnAuction);
  const pick = ctx.draftPick.get(p.id);
  if (pick) parts.push(dollarsAtRank(ctx, pick));
  const preseason = parts.length
    ? Math.max(FLOOR_DOLLARS, parts.reduce((a, v) => a + v, 0) / parts.length)
    : m?.espnRank
      ? dollarsAtRank(ctx, m.espnRank)
      : FLOOR_DOLLARS;

  const gp = gamesPlayed(p);
  const rank = m?.seasonRank ?? ctx.fallbackRank.get(p.id) ?? null;
  if (!gp || !rank) return preseason;
  const w = gp / (gp + SEASON_WEIGHT_GAMES);
  return (1 - w) * preseason + w * dollarsAtRank(ctx, rank);
}

export type Realism = "likely" | "fair" | "long shot";

export interface Acceptance {
  /** Market dollars the partner sends and receives. */
  partnerSends: number;
  partnerGets: number;
  /** What they'd want back: even, plus 10% if they're giving up the best player in the deal. */
  required: number;
  realism: Realism;
  reason: string;
}

/**
 * Would the partner take it? `partnerGives`/`partnerGets` are player lists; `partnerLineup`
 * is the change in their starting-lineup points (from teamValue).
 */
export function acceptance(
  partnerGives: RosterPlayer[],
  partnerGets: RosterPlayer[],
  partnerLineup: number,
  ctx: MarketContext,
): Acceptance {
  const value = (ps: RosterPlayer[]) => ps.reduce((a, p) => a + marketValue(p, ctx), 0);
  const sends = value(partnerGives);
  const gets = value(partnerGets);
  const best = (ps: RosterPlayer[]) => Math.max(0, ...ps.map((p) => marketValue(p, ctx)));
  // Consolidation: whoever gives up the best player in the deal wants a premium for it.
  const givesBest = best(partnerGives) > best(partnerGets);
  const required = sends * (givesBest && partnerGets.length > partnerGives.length ? 1.1 : 1);
  const ratio = required > 0 ? gets / required : Infinity;
  const realism: Realism =
    ratio >= 1.05 && partnerLineup >= 0 ? "likely" : ratio >= 0.95 ? "fair" : "long shot";
  const reason =
    realism === "long shot"
      ? `They'd give up $${sends.toFixed(0)} of market value for $${gets.toFixed(0)}${
          required > sends ? " (and want a premium for their best player)" : ""
        }.`
      : realism === "likely"
        ? `They get more market value ($${gets.toFixed(0)} for $${sends.toFixed(0)}) and their lineup improves.`
        : `About even on market value ($${gets.toFixed(0)} for $${sends.toFixed(0)}).`;
  return { partnerSends: sends, partnerGets: gets, required, realism, reason };
}
