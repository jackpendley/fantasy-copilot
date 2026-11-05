// Season simulations run elsewhere (the GitHub Actions worker): a plain-JSON form of SimInput,
// and one "chunk" of a move check, the base roster and each move played on the same seasons.
// Pure; the worker needs nothing but this package.

import { simulateSeason, type SimInput, type SimPlayer, type SimTeamResult } from "./sim";

/** SimInput as JSON: Maps become entry lists, `periodOf` a table by day. */
export interface WireInput {
  teams: SimInput["teams"];
  freeAgents: SimPlayer[];
  slotCounts: Record<string, number>;
  gameDays: [number, number[]][];
  /** Week of each day, index = day (0..lastDay). */
  periods: number[];
  fromDay: number;
  lastDay: number;
  matchups: SimInput["matchups"];
  regularWeeks: number;
  banked: [number, [number, number][]][];
  playoffWeeks: [number, number, number];
  addCapPerWeek: number;
}

export function toWire(input: SimInput): WireInput {
  return {
    teams: input.teams,
    freeAgents: input.freeAgents,
    slotCounts: input.slotCounts,
    gameDays: [...input.gameDays].map(([pro, days]) => [pro, [...days]]),
    periods: Array.from({ length: input.lastDay + 1 }, (_, d) => input.periodOf(d)),
    fromDay: input.fromDay,
    lastDay: input.lastDay,
    matchups: input.matchups,
    regularWeeks: input.regularWeeks,
    banked: [...input.banked].map(([team, byPeriod]) => [team, [...byPeriod]]),
    playoffWeeks: input.playoffWeeks,
    addCapPerWeek: input.addCapPerWeek,
  };
}

export function fromWire(
  w: WireInput,
  run: Pick<SimInput, "seasons" | "seed" | "playoffReplays" | "inspect">,
): SimInput {
  return {
    teams: w.teams,
    freeAgents: w.freeAgents,
    slotCounts: w.slotCounts,
    gameDays: new Map(w.gameDays.map(([pro, days]) => [pro, new Set(days)])),
    periodOf: (d) => w.periods[d] ?? w.periods.at(-1)!,
    fromDay: w.fromDay,
    lastDay: w.lastDay,
    matchups: w.matchups,
    regularWeeks: w.regularWeeks,
    banked: new Map(w.banked.map(([team, byPeriod]) => [team, new Map(byPeriod)])),
    playoffWeeks: w.playoffWeeks,
    addCapPerWeek: w.addCapPerWeek,
    ...run,
  };
}

/**
 * A move as the worker plays it: the rosters it changes, and the free agents it takes out of
 * the base pool or puts in (the pool stays sorted best first). Jobs queued before Nov 5 carry
 * the moving team's `roster`, `irCut` and the whole pool instead.
 */
export interface WireMove {
  key: string;
  teams?: { id: number; roster: SimPlayer[]; irCut?: number }[];
  faOut?: number[];
  faIn?: SimPlayer[];
  roster?: SimPlayer[];
  irCut?: number;
  freeAgents?: SimPlayer[];
}

/** The season with a move made (`teamId`: the team a legacy move changes). */
export function applyMove(base: WireInput, teamId: number, mv: WireMove): WireInput {
  const changed = new Map((mv.teams ?? []).map((t) => [t.id, t]));
  if (mv.roster) changed.set(teamId, { id: teamId, roster: mv.roster, irCut: mv.irCut });
  const out = new Set(mv.faOut ?? []);
  return {
    ...base,
    teams: base.teams.map((t) => {
      const c = changed.get(t.id);
      if (!c) return t;
      const { irCut: _, ...rest } = t;
      return { ...rest, roster: c.roster, ...(c.irCut != null ? { irCut: c.irCut } : {}) };
    }),
    freeAgents:
      mv.freeAgents ??
      (out.size || mv.faIn?.length
        ? [...base.freeAgents.filter((p) => !out.has(p.id)), ...(mv.faIn ?? [])].sort(
            (x, y) => y.fppg - x.fppg,
          )
        : base.freeAgents),
  };
}

/** One team's per-season outcomes the move checks compare. */
export const METRICS = ["title", "playoffs", "seed1", "bye", "wins"] as const;
export type Metric = (typeof METRICS)[number];

/** Sums over a chunk's seasons of a move's per-season difference from the base roster. */
export interface MetricSums {
  n: number;
  sum: number;
  sumsq: number;
}

export interface ChunkResult {
  chunk: number;
  seasons: number;
  /** The base run's odds for every team (the Outlook), over this chunk's seasons. */
  outlook: SimTeamResult[];
  /** The team's own base outcomes, summed. */
  base: Record<Metric, number>;
  /** Per move: paired differences (move − base) per metric. */
  moves: Record<string, Record<Metric, MetricSums>>;
}

/** The seed of a chunk: chunks are disjoint sets of seasons, so any set of them combines. */
export const chunkSeed = (chunk: number) => (20261018 + chunk * 7919) >>> 0;

/**
 * Play one chunk: the base roster and every move on the same `seasons` seasons (common random
 * numbers), recording `teamId`'s outcomes. Deterministic for a given chunk number.
 */
export function runChunk(
  base: WireInput,
  teamId: number,
  moves: WireMove[],
  chunk: number,
  seasons: number,
  replays: number,
): ChunkResult {
  const seed = chunkSeed(chunk);
  const play = (w: WireInput) => {
    const me = w.teams.findIndex((t) => t.id === teamId);
    const out: Record<Metric, Float64Array> = {
      title: new Float64Array(seasons),
      playoffs: new Float64Array(seasons),
      seed1: new Float64Array(seasons),
      bye: new Float64Array(seasons),
      wins: new Float64Array(seasons),
    };
    const summary = simulateSeason(
      fromWire(w, {
        seasons,
        seed,
        playoffReplays: replays,
        inspect: (s, o) => {
          out.title[s] = o.titleShares[me] ?? 0;
          out.playoffs[s] = o.playoffs.includes(teamId) ? 1 : 0;
          out.seed1[s] = o.seed1 === teamId ? 1 : 0;
          out.bye[s] = o.playoffs.slice(0, 2).includes(teamId) ? 1 : 0;
          out.wins[s] = o.wins[me] ?? 0;
        },
      }),
    );
    return { out, summary };
  };
  const b = play(base);
  const result: ChunkResult = {
    chunk,
    seasons,
    outlook: b.summary,
    base: Object.fromEntries(
      METRICS.map((m) => [m, b.out[m].reduce((a, x) => a + x, 0)]),
    ) as Record<Metric, number>,
    moves: {},
  };
  for (const mv of moves) {
    const o = play(applyMove(base, teamId, mv)).out;
    result.moves[mv.key] = Object.fromEntries(
      METRICS.map((m) => {
        let sum = 0;
        let sumsq = 0;
        for (let s = 0; s < seasons; s++) {
          const d = o[m][s]! - b.out[m][s]!;
          sum += d;
          sumsq += d * d;
        }
        return [m, { n: seasons, sum, sumsq }];
      }),
    ) as Record<Metric, MetricSums>;
  }
  return result;
}
