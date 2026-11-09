// The moves a worker job checks (ADR-058), most important first, and each built as a patch on
// the season as it stands: only Jack's roster and the free-agent pool change. Pure.

import type { RosterPlayer } from "@fantasy-copilot/espn";
import type { SimPlayer, WireInput, WireMove } from "@fantasy-copilot/fantasy-core";
import { LAST_SCORING_PERIOD } from "./calendar";
import { SIM_FREE_AGENTS, simFreeAgents, simRoster } from "./outlook";
import { valueContext } from "./trade";
import { absences } from "./availability";
import { shownMoves, waiverAnalysis, type StreamOption, type WaiverInputs } from "./waivers";

/** Moves played together on the same chunks of seasons (one base run per chunk). */
export const GROUP_SIZE = 12;
/** Best moves by the points estimate checked first, whatever the page shows. */
const TOP_MOVES = 15;
/** Drops checked per add that the Moves page doesn't show (the Free agents tab's column). */
const OTHER_DROPS = 3;

export const moveKey = (o: Pick<StreamOption, "add" | "drop" | "il">) =>
  `${o.add.player.id}:${o.drop?.id ?? ""}:${o.il?.id ?? ""}`;

/**
 * Every move worth a deep check, in the order they get seasons:
 * 1. each Moves card's opening drop (the Interested list's too), and the best by the points
 *    estimate;
 * 2. every other drop of the adds on Moves;
 * 3. for the other evaluated adds (the Free agents tab), their best few drops.
 * `first`: moves asked for by key, ahead of all of these. `leading`: how many are in 1;
 * `top`: how many of those are checked to the top precision (asked for, and the cards' opening
 * moves; ADR-060); `others`: where 3 starts (trade ideas go before it). `streamsTop: false`
 * checks the this-week streams' opening moves to the rest tier instead (the CPU saver).
 */
export function jobMoveOptions(
  a: Pick<ReturnType<typeof waiverAnalysis>, "best" | "thisWeek" | "dropOptions"> & {
    watched?: StreamOption[];
  },
  first: string[] = [],
  streamsTop = true,
): { options: StreamOption[]; leading: number; top: number; others: number } {
  const all = [...a.dropOptions.values()].flat();
  const byKey = new Map(all.map((o) => [moveKey(o), o]));
  const { best, streams } = shownMoves(a);
  const shown = [...best, ...streams, ...(a.watched ?? [])];
  const shownIds = new Set(shown.map((o) => o.add.player.id));
  const seen = new Set<string>();
  const unique = (list: StreamOption[]) =>
    list.filter((o) => {
      const k = moveKey(o);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const top = unique([
    ...first.flatMap((k) => byKey.get(k) ?? []),
    ...(streamsTop ? shown : [...best, ...(a.watched ?? [])]),
  ]);
  const opening = [
    ...top,
    ...unique(streamsTop ? [] : streams),
    ...unique([...all].sort((x, y) => y.netWins - x.netWins).slice(0, TOP_MOVES)),
  ];
  const rest = unique(shown.flatMap((o) => a.dropOptions.get(o.add.player.id) ?? []));
  const others = unique(
    [...a.dropOptions]
      .filter(([id]) => !shownIds.has(id))
      .flatMap(([, options]) => options.slice(0, OTHER_DROPS)),
  );
  return {
    options: [...opening, ...rest, ...others],
    leading: opening.length,
    top: top.length,
    others: opening.length + rest.length,
  };
}

/**
 * Split keys, in order, into groups of GROUP_SIZE; the first `top` keys (the top tier) never
 * share a group with the rest, since a group is checked to one precision.
 */
export function groupsOf(keys: string[], top = 0): string[][] {
  const out: string[][] = [];
  for (const part of [keys.slice(0, top), keys.slice(top)])
    for (let i = 0; i < part.length; i += GROUP_SIZE) out.push(part.slice(i, i + GROUP_SIZE));
  return out;
}

export interface MoveBuildArgs {
  /** The base season as the worker plays it. */
  base: WireInput;
  teamId: number;
  roster: RosterPlayer[];
  /** Every free agent (before the pool is cut to the best SIM_FREE_AGENTS). */
  freeAgents: RosterPlayer[];
  games: Parameters<typeof valueContext>[0];
  slotCounts: Record<string, number>;
  fromDay: number;
  regularWeeks: number;
  /** Known absences, including the candidate adds'. */
  injured: Map<number, { outUntil: number }>;
}

/**
 * Each option as a WireMove: Jack's roster with it (and whom an IR return would then cut),
 * and the free agents it takes out of or puts into the base pool.
 */
export function buildWireMoves(a: MoveBuildArgs, options: StreamOption[]): WireMove[] {
  const ctx = valueContext(
    a.games,
    a.slotCounts,
    a.fromDay,
    LAST_SCORING_PERIOD,
    a.regularWeeks,
    a.injured,
  );
  const pool = simFreeAgents(a.freeAgents, a.injured);
  const inBase = new Set(a.base.freeAgents.map((p) => p.id));
  return options.map((o) => {
    const roster = [
      ...a.roster
        .filter((p) => p.id !== o.drop?.id)
        .map((p) => (p.id === o.il?.id ? { ...p, slot: "IR" } : p)),
      { ...o.add.player, slot: "BE" },
    ];
    const team = simRoster(roster, ctx, a.injured);
    // The pool without the add and with the dropped player, cut to the best again.
    const dropped = o.drop ? simFreeAgents([o.drop], a.injured) : [];
    const next = [...pool.filter((p) => p.id !== o.add.player.id), ...dropped]
      .sort((x, y) => y.fppg - x.fppg)
      .slice(0, SIM_FREE_AGENTS);
    const nextIds = new Set(next.map((p) => p.id));
    const faIn: SimPlayer[] = next.filter((p) => !inBase.has(p.id));
    return {
      key: moveKey(o),
      teams: [{ id: a.teamId, ...team }],
      faOut: [...inBase].filter((id) => !nextIds.has(id)),
      faIn,
    };
  });
}

/** A group's state in a job (sim_groups). prio 0: asked for; 1: opening moves; 2: the rest. */
export interface SimGroup {
  grp: number;
  prio: number;
  /** How many of its moves still get seasons. */
  n_active: number;
  next_chunk: number;
  posted: number;
  /** Its tier's season limits, in chunks (ADR-060). */
  min_chunks: number;
  max_chunks: number;
}

/** Can this group take more chunks? Group 0 also carries the base run to its minimum. */
export const hasChunksLeft = (g: SimGroup, minBaseChunks: number) =>
  g.next_chunk < g.max_chunks && (g.n_active > 0 || (g.grp === 0 && g.next_chunk < minBaseChunks));

/** Chunks other groups may have out before their first results come back. */
const AHEAD_OTHER = 6;
const AHEAD_MAX = 32;

/**
 * The group a runner's next chunks go to: the most important one under its limit of chunks
 * out before results come back. That limit is enough for a first estimate (its tier's minimum for
 * the opening moves, which go straight to the minimum seasons), then grows with what it has
 * posted, so seasons follow the moves still close. When every group is at its limit, the most
 * important one takes more (idle runners help nobody).
 */
export function pickGroup<G extends SimGroup>(groups: G[], minBaseChunks: number): G | null {
  const open = groups
    .filter((g) => hasChunksLeft(g, minBaseChunks))
    .sort((a, b) => a.prio - b.prio || a.grp - b.grp);
  const limit = (g: G) =>
    Math.min(AHEAD_MAX, Math.max(g.prio <= 1 ? g.min_chunks : AHEAD_OTHER, g.posted));
  return open.find((g) => g.next_chunk - g.posted < limit(g)) ?? open[0] ?? null;
}

/** A trade idea's key among the moves (sorted ids, so the same trade has one key). */
export const tradeKey = (partnerId: number, give: number[], get: number[]) =>
  `trade:${partnerId}:${[...give].sort((a, b) => a - b).join(".")}:${[...get].sort((a, b) => a - b).join(".")}`;

/** Trade ideas the worker checks (the best by the search's score). */
export const TRADE_MOVES = 15;

/** A stored trade idea's players (lib/nba/trade-task.ts StoredIdea). */
export interface TradeSpec {
  partnerId: number;
  give: number[];
  get: number[];
  moves: {
    mine: { dropped: number[]; added: number[]; toIL: number[] };
    theirs: { dropped: number[]; added: number[]; toIL: number[] };
  };
}

/**
 * Each trade idea as a WireMove: both rosters after it (with the same drops, pickups and IL
 * moves the trade search made), and the free agents it takes or frees. Ideas whose players
 * have moved since are skipped.
 */
export function buildTradeMoves(
  a: MoveBuildArgs & { teams: { id: number; roster: RosterPlayer[] }[] },
  ideas: TradeSpec[],
): WireMove[] {
  const ctx = valueContext(
    a.games,
    a.slotCounts,
    a.fromDay,
    LAST_SCORING_PERIOD,
    a.regularWeeks,
    a.injured,
  );
  const pool = simFreeAgents(a.freeAgents, a.injured);
  const inBase = new Set(a.base.freeAgents.map((p) => p.id));
  const freeById = new Map(a.freeAgents.map((p) => [p.id, p]));
  const out: WireMove[] = [];
  for (const idea of ideas) {
    const partner = a.teams.find((t) => t.id === idea.partnerId);
    if (!partner) continue;
    const mineById = new Map(a.roster.map((p) => [p.id, p]));
    const theirsById = new Map(partner.roster.map((p) => [p.id, p]));
    // As applyTrade made it: the roster without who goes, the incoming players (on IR or the
    // bench), without the players it cut, plus its free-agent pickups on the bench.
    const side = (
      roster: RosterPlayer[],
      out: number[],
      incoming: (RosterPlayer | undefined)[],
      m: TradeSpec["moves"]["mine"],
    ): RosterPlayer[] | null => {
      const added = m.added.map((id) => freeById.get(id));
      if (incoming.some((p) => !p) || added.some((p) => !p)) return null;
      const gone = new Set(out);
      const cut = new Set(m.dropped);
      const toIL = new Set(m.toIL);
      return [
        ...roster.filter((p) => !gone.has(p.id)),
        ...(incoming as RosterPlayer[]).map((p) => ({ ...p, slot: toIL.has(p.id) ? "IR" : "BE" })),
      ]
        .filter((p) => !cut.has(p.id))
        .concat((added as RosterPlayer[]).map((p) => ({ ...p, slot: "BE" })));
    };
    const mine = side(
      a.roster,
      idea.give,
      idea.get.map((id) => theirsById.get(id)),
      idea.moves.mine,
    );
    const theirs = side(
      partner.roster,
      idea.get,
      idea.give.map((id) => mineById.get(id)),
      idea.moves.theirs,
    );
    if (!mine || !theirs) continue;
    const taken = new Set([...idea.moves.mine.added, ...idea.moves.theirs.added]);
    const freed = [...idea.moves.mine.dropped, ...idea.moves.theirs.dropped]
      .map((id) => mineById.get(id) ?? theirsById.get(id))
      .filter((p): p is RosterPlayer => p != null);
    const next = [...pool.filter((p) => !taken.has(p.id)), ...simFreeAgents(freed, a.injured)]
      .sort((x, y) => y.fppg - x.fppg)
      .slice(0, SIM_FREE_AGENTS);
    const nextIds = new Set(next.map((p) => p.id));
    out.push({
      key: tradeKey(idea.partnerId, idea.give, idea.get),
      teams: [
        { id: a.teamId, ...simRoster(mine, ctx, a.injured) },
        { id: idea.partnerId, ...simRoster(theirs, ctx, a.injured) },
      ],
      faOut: [...inBase].filter((id) => !nextIds.has(id)),
      faIn: next.filter((p) => !inBase.has(p.id)),
    });
  }
  return out;
}

/** Everything a simulation job's moves are built from (the worker's sim-build task input). */
export interface SimBuildInput extends Omit<MoveBuildArgs, "injured"> {
  /** The add-and-drop analysis' inputs (lib/nba/waivers-view.ts). */
  waiver: WaiverInputs;
  /** Moves asked for, ahead of the rest. */
  extraKeys: string[];
  /** Streams' opening moves at the top tier (false under the CPU saver); absent = true. */
  streamsTop?: boolean;
  /** Known absences (the season setup's), and the injury feed for the adds' own. */
  injured: Map<number, { outUntil: number }>;
  injuries: Parameters<typeof absences>[1];
  teams: { id: number; roster: RosterPlayer[] }[];
  ideas: TradeSpec[];
  /**
   * The Interested list's "Trade for him" packages: each watched player's best (top tier,
   * ADR-060) and the next ones (with the other trade ideas).
   */
  interest?: { top: TradeSpec[]; rest: TradeSpec[] };
}

/**
 * A job's moves, in order: run the add-and-drop analysis, pick the moves to check
 * (jobMoveOptions), then build each as a patch, trade ideas before the Free agents tab's moves.
 */
export function buildSimMoves(i: SimBuildInput): {
  moves: WireMove[];
  leading: number;
  top: number;
  others: number;
} {
  const analysis = waiverAnalysis(i.waiver);
  const { options, leading, top, others } = jobMoveOptions(
    analysis,
    i.extraKeys,
    i.streamsTop ?? true,
  );
  // The adds' own absences (they're not on a roster, so not in the setup's).
  const injured = new Map(i.injured);
  const adds = options.map((o) => o.add.player);
  for (const [id, a] of absences(adds, i.injuries, i.fromDay)) injured.set(id, a);
  const args: MoveBuildArgs = {
    base: i.base,
    teamId: i.teamId,
    roster: i.roster,
    freeAgents: i.freeAgents,
    games: i.games,
    slotCounts: i.slotCounts,
    fromDay: i.fromDay,
    regularWeeks: i.regularWeeks,
    injured,
  };
  const waiver = buildWireMoves(args, options);
  const withTeams = { ...args, teams: i.teams };
  // The watched players' best packages join the top tier, after the waiver moves in it.
  const interestTop = buildTradeMoves(withTeams, i.interest?.top ?? []);
  const seen = new Set(interestTop.map((m) => m.key));
  const trades = buildTradeMoves(withTeams, [...i.ideas, ...(i.interest?.rest ?? [])]).filter(
    (m) => !seen.has(m.key) && seen.add(m.key),
  );
  return {
    moves: [
      ...waiver.slice(0, top),
      ...interestTop,
      ...waiver.slice(top, others),
      ...trades,
      ...waiver.slice(others),
    ],
    leading: leading + interestTop.length,
    top: top + interestTop.length,
    others: others + interestTop.length,
  };
}
