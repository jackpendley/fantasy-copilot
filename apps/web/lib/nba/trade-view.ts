import "server-only";
// Trade targets without the wait. The search takes seconds (every 1-for-1 up to 3-for-3 with
// every team), so its result is kept in view_cache, keyed by a fingerprint of everything it
// depends on: the day, every roster, injuries and the free-agent pool. A page whose
// fingerprint matches reads it in one query. When the inputs have moved on, the page shows
// the stored ideas that still make sense (every player still where the idea expects him)
// while a fresh search runs after the response. Roster moves and the nightly job refresh it
// ahead of time, so the page rarely waits.
//
// The search is the costliest thing the app did on Vercel (~7.5 s of CPU, docs/COMPUTE.md):
// with the worker set up it runs there (a worker task), and Vercel only builds its input.
// Other teams' moves, injury news and page visits refresh it at most every 15 minutes (every
// 3 hours when it runs on Vercel); Jack's own moves and the nightly run refresh it right away.

import { after } from "next/server";
import type { FantasyTeam, RosterPlayer } from "@fantasy-copilot/espn";
import { minimalOn } from "@/lib/cpu-saver";
import { dbConfigured } from "@/lib/db";
import { fingerprintOf, readView, writeView } from "@/lib/view-cache";
import { loadLeagueView } from "./league-view";
import { findTradeTargets, type TradeIdea } from "./trade";
import { PACKAGES_PER_TARGET, compact, tradeSearchInput, type StoredIdea } from "./trade-task";
import { enqueueTask, taskPending } from "./worker-tasks";

export { compact, type StoredIdea };

type LeagueView = Awaited<ReturnType<typeof loadLeagueView>>;
/** What reading stored ideas needs: the rosters as they stand and the free agents. */
type Rosters = {
  data: { teams: FantasyTeam[]; me: FantasyTeam };
  freeAgents: RosterPlayer[];
};

const KEY = "trade-targets";
/** "Trade for him" packages for the watched players on other teams, by player id. */
export const TRADE_FOR_KEY = "trade-for";
/** Changes other than Jack's own moves refresh the ideas at most this often (on Vercel)... */
export const TRADE_REFRESH_GAP_MS = 3 * 3600_000;
/** ...or on the worker. */
export const WORKER_REFRESH_GAP_MS = 15 * 60_000;

/** The search runs on the GitHub Actions worker (it's set up, and results can be stored). */
const onWorker = () => Boolean(process.env.WORKER_SECRET) && dbConfigured();

/**
 * Is a refresh allowed now (no stored ideas, or they're older than the gap)? In minimal mode
 * (lib/cpu-saver.ts) only nightly and Jack's own moves refresh them.
 */
export const refreshDue = (
  computedAt: Date | null,
  now = Date.now(),
  gap = onWorker() ? WORKER_REFRESH_GAP_MS : TRADE_REFRESH_GAP_MS,
) => computedAt == null || (!minimalOn(now) && now - computedAt.getTime() >= gap);

/** Everything the search depends on. */
export function tradeFingerprint(v: LeagueView): string {
  const roster = (r: RosterPlayer[]) =>
    r.map((p) => [p.id, p.slot, p.injuryStatus ?? null, p.pendingIR ?? false]).sort();
  return fingerprintOf({
    sp: v.sp,
    teams: v.data.teams.map((t) => [t.id, roster(t.roster)]).sort(),
    injured: [...v.injured].map(([id, a]) => [id, a.outUntil]).sort(),
    freeAgents: v.freeAgents.map((p) => p.id).sort(),
    noTrade: [...v.prefs.noTrade].sort(),
    noDrop: [...v.prefs.noDrop].sort(),
  });
}

/** The Trades page with this trade filled in. */
export const tradeHref = (team: number, give: number[], get: number[]) =>
  `/nba/league/trades?team=${team}${give.map((g) => `&give=${g}`).join("")}${get.map((g) => `&get=${g}`).join("")}`;

/** Jack's watched players who are on other teams (their "Trade for him" packages). */
export function interestTargets(v: Rosters): number[] {
  const elsewhere = new Set(
    v.data.teams.filter((t) => t.id !== v.data.me.id).flatMap((t) => t.roster.map((p) => p.id)),
  );
  return (v.data.me.watchList ?? []).filter((id) => elsewhere.has(id)).sort((a, b) => a - b);
}

/** Jack's side of the search, with his protected players. */
const mySide = (v: LeagueView) => ({
  teamId: v.data.me.id,
  roster: v.data.me.roster,
  noTrade: [...v.prefs.noTrade],
  noDrop: [...v.prefs.noDrop],
});

/**
 * Stored ideas rebuilt from today's players. An idea is dropped when any of its players is no
 * longer where it expects him (traded, dropped, or a free agent who was picked up).
 */
export function hydrate(stored: StoredIdea[], v: Rosters): TradeIdea[] {
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
    mySide(v),
    v.data.teams
      .filter((t) => t.id !== v.data.me.id)
      .map((t) => ({ teamId: t.id, roster: t.roster })),
    v.ctx,
    v.market,
    v.freeAgents,
  );
}

function searchInput(v: LeagueView) {
  return tradeSearchInput(
    mySide(v),
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

/**
 * Queue the search for the worker (its result lands in view_cache under KEY). The Interested
 * list's packages are searched only when Jack asks (Nov 9): they were re-searched, and
 * re-simulated at the top tier, with every job.
 */
async function queueSearch(v: LeagueView, fingerprint: string): Promise<boolean> {
  return enqueueTask("trade-search", fingerprint, searchInput(v));
}

export interface TradeForPackages {
  /** Per watched player on another team: the best packages that get him (best first). */
  packages: Map<number, TradeIdea[]>;
  /** Searched at least once for him (an empty list then means no package works). */
  searched: Set<number>;
  /** A search for them is running. */
  updating: boolean;
}

/**
 * The Interested list's packages, from the last search (refreshed with the trade ideas;
 * packages whose players have moved are left out).
 */
export async function tradeForPackages(v: Rosters): Promise<TradeForPackages> {
  const [row, updating] = dbConfigured()
    ? await Promise.all([
        readView<Record<string, StoredIdea[]>>(TRADE_FOR_KEY).catch(() => null),
        taskPending("trade-for").catch(() => false),
      ])
    : [null, false];
  const packages = new Map<number, TradeIdea[]>();
  const searched = new Set<number>();
  for (const id of interestTargets(v)) {
    const stored = row?.value[id];
    if (!stored) continue;
    searched.add(id);
    packages.set(id, hydrate(stored, v).slice(0, PACKAGES_PER_TARGET));
  }
  return { packages, searched, updating };
}

export interface TradeTargets {
  ideas: TradeIdea[];
  /** False when rosters or news changed since the search (the ideas shown are the last ones). */
  fresh: boolean;
  /** A fresh search is running now (otherwise the next comes within TRADE_REFRESH_GAP_MS). */
  updating: boolean;
  computedAt: Date;
}

/** The page's trade targets: stored when current, otherwise the last ones while refreshing. */
export async function tradeTargets(v: LeagueView): Promise<TradeTargets> {
  if (!dbConfigured())
    return { ideas: search(v), fresh: true, updating: false, computedAt: new Date() };
  const fingerprint = tradeFingerprint(v);
  const row = await readView<StoredIdea[]>(KEY).catch(() => null);
  if (row?.fingerprint === fingerprint) {
    return {
      ideas: hydrate(row.value, v),
      fresh: true,
      updating: false,
      computedAt: row.computedAt,
    };
  }
  if (row) {
    const due = refreshDue(row.computedAt);
    if (due) after(() => refreshTradeTargets({ force: true }).catch(() => {}));
    const updating = due || (onWorker() && (await taskPending("trade-search").catch(() => false)));
    return { ideas: hydrate(row.value, v), fresh: false, updating, computedAt: row.computedAt };
  }
  if (onWorker()) {
    await queueSearch(v, fingerprint);
    return { ideas: [], fresh: false, updating: true, computedAt: new Date() };
  }
  const ideas = await computeAndStore(v, fingerprint);
  return { ideas, fresh: true, updating: false, computedAt: new Date() };
}

let running: Promise<boolean> | null = null;

/**
 * Bring the stored targets up to date (after a roster move, a new injury, and nightly).
 * True when it searched; false when they were current, or (without `force`) searched less
 * than TRADE_REFRESH_GAP_MS ago. One search at a time per instance.
 */
export function refreshTradeTargets({ force = false }: { force?: boolean } = {}): Promise<boolean> {
  running ??= (async () => {
    const row = await readView<StoredIdea[]>(KEY).catch(() => null);
    if (!force && row && !refreshDue(row.computedAt)) return false;
    const v = await loadLeagueView();
    const fingerprint = tradeFingerprint(v);
    if (row?.fingerprint === fingerprint) return false;
    if (onWorker()) return queueSearch(v, fingerprint);
    await computeAndStore(v, fingerprint);
    return true;
  })().finally(() => {
    running = null;
  });
  return running;
}
