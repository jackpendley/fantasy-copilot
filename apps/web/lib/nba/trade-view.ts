import "server-only";
// Trade targets without the wait. The search takes seconds (every 1-for-1 up to 3-for-3 with
// every team), so its result is kept in view_cache, keyed by a fingerprint of everything it
// depends on: the day, every roster, injuries and the free-agent pool. A page whose
// fingerprint matches reads it in one query. When the inputs have moved on, the page shows
// the stored ideas that still make sense (every player still where the idea expects him)
// while a fresh search runs after the response. Roster moves and the nightly job refresh it
// ahead of time, so the page rarely waits.

import { after } from "next/server";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { dbConfigured } from "@/lib/db";
import { fingerprintOf, readView, writeView } from "@/lib/view-cache";
import { loadLeagueView } from "./league-view";
import { findTradeTargets, type RosterMoves, type TradeIdea } from "./trade";

type LeagueView = Awaited<ReturnType<typeof loadLeagueView>>;

const KEY = "trade-targets";

type StoredMoves = Record<keyof RosterMoves, number[]>;
export interface StoredIdea extends Omit<TradeIdea, "give" | "get" | "moves"> {
  give: number[];
  get: number[];
  moves: { mine: StoredMoves; theirs: StoredMoves };
}

/** Everything the search depends on. */
export function tradeFingerprint(v: LeagueView): string {
  const roster = (r: RosterPlayer[]) =>
    r.map((p) => [p.id, p.slot, p.injuryStatus ?? null, p.pendingIR ?? false]).sort();
  return fingerprintOf({
    sp: v.sp,
    teams: v.data.teams.map((t) => [t.id, roster(t.roster)]).sort(),
    injured: [...v.injured].map(([id, a]) => [id, a.outUntil]).sort(),
    freeAgents: v.freeAgents.map((p) => p.id).sort(),
  });
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

/**
 * Stored ideas rebuilt from today's players. An idea is dropped when any of its players is no
 * longer where it expects him (traded, dropped, or a free agent who was picked up).
 */
export function hydrate(stored: StoredIdea[], v: LeagueView): TradeIdea[] {
  const rosters = new Map(v.data.teams.map((t) => [t.id, new Map(t.roster.map((p) => [p.id, p]))]));
  const free = new Map(v.freeAgents.map((p) => [p.id, p]));
  const mine = rosters.get(v.data.me.id)!;
  const pick = (from: Map<number, RosterPlayer> | undefined, wanted: number[]) => {
    const out = wanted.map((id) => from?.get(id));
    return out.every(Boolean) ? (out as RosterPlayer[]) : null;
  };
  const ideas: TradeIdea[] = [];
  for (const s of stored) {
    const theirs = rosters.get(s.partnerId);
    const give = pick(mine, s.give);
    const get = pick(theirs, s.get);
    if (!give || !get) continue;
    const incoming = new Map(get.map((p) => [p.id, p]));
    const outgoing = new Map(give.map((p) => [p.id, p]));
    const moves = {
      mine: {
        dropped: pick(mine, s.moves.mine.dropped),
        added: pick(free, s.moves.mine.added),
        toIL: pick(incoming, s.moves.mine.toIL),
      },
      theirs: {
        dropped: pick(theirs, s.moves.theirs.dropped),
        added: pick(free, s.moves.theirs.added),
        toIL: pick(outgoing, s.moves.theirs.toIL),
      },
    };
    if (![...Object.values(moves.mine), ...Object.values(moves.theirs)].every(Boolean)) continue;
    ideas.push({ ...s, give, get, moves: moves as TradeIdea["moves"] });
  }
  return ideas;
}

function search(v: LeagueView): TradeIdea[] {
  return findTradeTargets(
    { teamId: v.data.me.id, roster: v.data.me.roster },
    v.data.teams
      .filter((t) => t.id !== v.data.me.id)
      .map((t) => ({ teamId: t.id, roster: t.roster })),
    v.ctx,
    v.market,
    v.freeAgents,
  );
}

async function computeAndStore(v: LeagueView, fingerprint: string): Promise<TradeIdea[]> {
  const t0 = performance.now();
  const ideas = search(v);
  await writeView(KEY, fingerprint, ideas.map(compact), performance.now() - t0);
  return ideas;
}

export interface TradeTargets {
  ideas: TradeIdea[];
  /** False while a fresh search runs for changed rosters (the ideas shown are the last ones). */
  fresh: boolean;
  computedAt: Date;
}

/** The page's trade targets: stored when current, otherwise the last ones while refreshing. */
export async function tradeTargets(v: LeagueView): Promise<TradeTargets> {
  if (!dbConfigured()) return { ideas: search(v), fresh: true, computedAt: new Date() };
  const fingerprint = tradeFingerprint(v);
  const row = await readView<StoredIdea[]>(KEY).catch(() => null);
  if (row?.fingerprint === fingerprint) {
    return { ideas: hydrate(row.value, v), fresh: true, computedAt: row.computedAt };
  }
  if (row) {
    after(() => refreshTradeTargets().catch(() => {}));
    return { ideas: hydrate(row.value, v), fresh: false, computedAt: row.computedAt };
  }
  const ideas = await computeAndStore(v, fingerprint);
  return { ideas, fresh: true, computedAt: new Date() };
}

let running: Promise<boolean> | null = null;

/**
 * Bring the stored targets up to date (after a roster move, a new injury, and nightly).
 * True when it searched; false when they were current. One search at a time per instance.
 */
export function refreshTradeTargets(): Promise<boolean> {
  running ??= (async () => {
    const v = await loadLeagueView();
    const fingerprint = tradeFingerprint(v);
    const row = await readView<StoredIdea[]>(KEY).catch(() => null);
    if (row?.fingerprint === fingerprint) return false;
    await computeAndStore(v, fingerprint);
    return true;
  })().finally(() => {
    running = null;
  });
  return running;
}
