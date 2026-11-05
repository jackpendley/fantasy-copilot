// The trade idea search as a worker task (docs/COMPUTE.md): its inputs as plain JSON, the
// search, and the ideas in their stored form. The search costs seconds of CPU, so it runs on
// the GitHub Actions worker; Vercel only builds the input. Pure (the worker bundles it).

import type { RosterPlayer } from "@fantasy-copilot/espn";
import type { MarketContext } from "./market";
import {
  findTradeTargets,
  type RosterMoves,
  type TradeIdea,
  type TradeSide,
  type ValueContext,
} from "./trade";

type StoredMoves = Record<keyof RosterMoves, number[]>;
export interface StoredIdea extends Omit<TradeIdea, "give" | "get" | "moves"> {
  give: number[];
  get: number[];
  moves: { mine: StoredMoves; theirs: StoredMoves };
}

const ids = (ps: RosterPlayer[]) => ps.map((p) => p.id);
const storeMoves = (m: RosterMoves): StoredMoves => ({
  dropped: ids(m.dropped),
  added: ids(m.added),
  toIL: ids(m.toIL),
});

export function compact(i: TradeIdea): StoredIdea {
  return {
    ...i,
    give: ids(i.give),
    get: ids(i.get),
    moves: { mine: storeMoves(i.moves.mine), theirs: storeMoves(i.moves.theirs) },
  };
}

/** The search's inputs as JSON (Maps become entry lists). */
export interface TradeSearchInput {
  me: TradeSide;
  others: TradeSide[];
  ctx: Omit<ValueContext, "gameDays" | "outUntil"> & {
    gameDays: [number, number[]][];
    outUntil: [number, number][];
  };
  market: { curve: number[]; draftPick: [number, number][]; fallbackRank: [number, number][] };
  freeAgents: RosterPlayer[];
}

export function tradeSearchInput(
  me: TradeSide,
  others: TradeSide[],
  ctx: ValueContext,
  market: MarketContext,
  freeAgents: RosterPlayer[],
): TradeSearchInput {
  return {
    me,
    others,
    ctx: {
      ...ctx,
      gameDays: [...ctx.gameDays].map(([pro, days]) => [pro, [...days]]),
      outUntil: [...ctx.outUntil],
    },
    market: {
      curve: market.curve,
      draftPick: [...market.draftPick],
      fallbackRank: [...market.fallbackRank],
    },
    freeAgents,
  };
}

/** Run the search from its JSON input; the ideas as stored (best first). */
export function runTradeSearch(input: TradeSearchInput): StoredIdea[] {
  const ctx: ValueContext = {
    ...input.ctx,
    gameDays: new Map(input.ctx.gameDays.map(([pro, days]) => [pro, new Set(days)])),
    outUntil: new Map(input.ctx.outUntil),
  };
  const market: MarketContext = {
    curve: input.market.curve,
    draftPick: new Map(input.market.draftPick),
    fallbackRank: new Map(input.market.fallbackRank),
  };
  return findTradeTargets(input.me, input.others, ctx, market, input.freeAgents).map(compact);
}
