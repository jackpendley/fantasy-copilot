// The moves a worker job checks (ADR-058), most important first, and each built as a patch on
// the season as it stands: only Jack's roster and the free-agent pool change. Pure.

import type { RosterPlayer } from "@fantasy-copilot/espn";
import type { SimPlayer, WireInput, WireMove } from "@fantasy-copilot/fantasy-core";
import { LAST_SCORING_PERIOD } from "./calendar";
import { SIM_FREE_AGENTS, simFreeAgents, simRoster } from "./outlook";
import { valueContext } from "./trade";
import { shownMoves, type StreamOption, type waiverAnalysis } from "./waivers";

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
 * 1. each Moves card's opening drop, and the best by the points estimate;
 * 2. every other drop of the adds on Moves;
 * 3. for the other evaluated adds (the Free agents tab), their best few drops.
 * `first`: moves asked for by key, ahead of all of these. `leading`: how many are in 1.
 */
export function jobMoveOptions(
  a: Pick<ReturnType<typeof waiverAnalysis>, "best" | "thisWeek" | "dropOptions">,
  first: string[] = [],
): { options: StreamOption[]; leading: number } {
  const all = [...a.dropOptions.values()].flat();
  const byKey = new Map(all.map((o) => [moveKey(o), o]));
  const { best, streams } = shownMoves(a);
  const shown = [...best, ...streams];
  const shownIds = new Set(shown.map((o) => o.add.player.id));
  const seen = new Set<string>();
  const unique = (list: StreamOption[]) =>
    list.filter((o) => {
      const k = moveKey(o);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const opening = unique([
    ...first.flatMap((k) => byKey.get(k) ?? []),
    ...shown,
    ...[...all].sort((x, y) => y.netWins - x.netWins).slice(0, TOP_MOVES),
  ]);
  const rest = unique([
    ...shown.flatMap((o) => a.dropOptions.get(o.add.player.id) ?? []),
    ...[...a.dropOptions]
      .filter(([id]) => !shownIds.has(id))
      .flatMap(([, options]) => options.slice(0, OTHER_DROPS)),
  ]);
  return { options: [...opening, ...rest], leading: opening.length };
}

/** Split keys, in order, into groups of GROUP_SIZE. */
export function groupsOf(keys: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < keys.length; i += GROUP_SIZE) out.push(keys.slice(i, i + GROUP_SIZE));
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
  active: string[];
  next_chunk: number;
  posted: number;
}

/** Can this group take more chunks? Group 0 also carries the base run to its minimum. */
export const hasChunksLeft = (g: SimGroup, maxChunks: number, minBaseChunks: number) =>
  g.next_chunk < maxChunks &&
  (g.active.length > 0 || (g.grp === 0 && g.next_chunk < minBaseChunks));

/** Chunks other groups may have out before their first results come back. */
const AHEAD_OTHER = 6;
const AHEAD_MAX = 32;

/**
 * The group a runner's next chunks go to: the most important one under its limit of chunks
 * out before results come back. That limit is enough for a first estimate (`aheadFirst` for
 * the opening moves, which go straight to the minimum seasons), then grows with what it has
 * posted, so seasons follow the moves still close. When every group is at its limit, the most
 * important one takes more (idle runners help nobody).
 */
export function pickGroup<G extends SimGroup>(
  groups: G[],
  maxChunks: number,
  minBaseChunks: number,
  aheadFirst: number,
): G | null {
  const open = groups
    .filter((g) => hasChunksLeft(g, maxChunks, minBaseChunks))
    .sort((a, b) => a.prio - b.prio || a.grp - b.grp);
  const limit = (g: G) =>
    Math.min(AHEAD_MAX, Math.max(g.prio <= 1 ? aheadFirst : AHEAD_OTHER, g.posted));
  return open.find((g) => g.next_chunk - g.posted < limit(g)) ?? open[0] ?? null;
}
