// Deep move checks (ADR-053): combine the worker's chunks into each move's effect, decide which
// moves still need seasons, and how likely each is to beat doing nothing and to be the best.
// Pure.

import {
  METRICS,
  type ChunkResult,
  type Metric,
  type MetricSums,
  type SimTeamResult,
} from "@fantasy-copilot/fantasy-core";

/**
 * How precisely a move is checked (ADR-060): it stops once its title change is known to
 * ±target (two standard errors), but not before `minSeasons` and never past `maxSeasons`.
 */
export interface Tier {
  target2se: number;
  minSeasons: number;
  maxSeasons: number;
}
/** The moves Jack acts on: each Moves card's opening move, streams, his watch list. */
export const TOP_TIER: Tier = { target2se: 0.0035, minSeasons: 4_000, maxSeasons: 40_000 };
/** Everything else (other drops, trade ideas, the Free agents tab): enough to rank them. */
export const REST_TIER: Tier = { target2se: 0.01, minSeasons: 1_000, maxSeasons: 6_000 };
/** A move worse than doing nothing by four standard errors stops after this many (ADR-058). */
export const EARLY_SEASONS = 1_000;
/** The Outlook (the base run) gets at least this many seasons. */
export const MIN_BASE_SEASONS = 8_000;

export interface Delta {
  d: number;
  se: number;
}

export interface DeepEffect {
  key: string;
  seasons: number;
  title: Delta;
  playoffs: Delta;
  seed1: Delta;
  bye: Delta;
  wins: Delta;
  /** Chance the move raises his title odds at all (normal approximation of its estimate). */
  pBetter: number;
  /** Share of resamples in which it had the biggest title gain of the moves still checked. */
  pBest: number | null;
  /** Still getting seasons. */
  active: boolean;
  /** Stopped early: clearly worse than doing nothing. */
  dropped: boolean;
}

const deltaOf = (s: MetricSums): Delta => {
  if (!s.n) return { d: 0, se: 0 };
  const d = s.sum / s.n;
  const v = s.n > 1 ? Math.max(0, (s.sumsq - s.n * d * d) / (s.n - 1)) : 0;
  return { d, se: Math.sqrt(v / s.n) };
};

function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Should a move get more seasons (checked to its tier's precision)? */
export function needsMore(
  e: Pick<DeepEffect, "seasons" | "title" | "wins">,
  tier: Tier = TOP_TIER,
): {
  more: boolean;
  dropped: boolean;
} {
  if (e.seasons >= tier.maxSeasons) return { more: false, dropped: false };
  const worse = (x: Delta, k: number) => x.d + k * x.se < 0;
  if (e.seasons >= EARLY_SEASONS && worse(e.title, 4) && worse(e.wins, 4))
    return { more: false, dropped: true };
  if (e.seasons < tier.minSeasons) return { more: true, dropped: false };
  if (worse(e.title, 2) && worse(e.wins, 2)) return { more: false, dropped: true };
  return { more: 2 * e.title.se > tier.target2se, dropped: false };
}

/** A tiny seeded generator for the resampling (reproducible results). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** A move's summed per-season differences from the base roster, per metric. */
export type MoveSums = Record<Metric, MetricSums>;

const emptySums = () =>
  Object.fromEntries(METRICS.map((m) => [m, { n: 0, sum: 0, sumsq: 0 }])) as MoveSums;

/**
 * Each move's effect from its sums over all chunks so far (P(best) still unset). `tierOf`: the
 * precision each move is checked to.
 */
export function effectsFromSums(
  keys: string[],
  sums: Map<string, MoveSums>,
  tierOf: (key: string) => Tier = () => TOP_TIER,
): DeepEffect[] {
  return keys.map((key) => {
    const s = sums.get(key) ?? emptySums();
    const e = {
      key,
      seasons: s.title.n,
      title: deltaOf(s.title),
      playoffs: deltaOf(s.playoffs),
      seed1: deltaOf(s.seed1),
      bye: deltaOf(s.bye),
      wins: deltaOf(s.wins),
    };
    const next = needsMore(e, tierOf(key));
    return {
      ...e,
      pBetter: e.title.se > 0 ? normalCdf(e.title.d / e.title.se) : e.title.d > 0 ? 1 : 0,
      pBest: null,
      active: next.more,
      dropped: next.dropped,
    };
  });
}

/** At most this many moves compete for "best"; the rest are out of reach. */
const MAX_CONTENDERS = 12;

/**
 * The moves that could still be the best: not dropped, and within three standard errors of
 * the leader's title change (`among`: the keys that count, e.g. waiver moves only).
 */
export function contendersOf(effects: DeepEffect[], among?: Set<string>): DeepEffect[] {
  const live = effects.filter((e) => !e.dropped && e.seasons > 0 && (!among || among.has(e.key)));
  const top = live.reduce<DeepEffect | null>((b, e) => (!b || e.title.d > b.title.d ? e : b), null);
  if (!top) return [];
  const floor = top.title.d - 3 * top.title.se;
  return live
    .filter((e) => e.title.d + 3 * e.title.se >= floor)
    .sort((a, b) => b.title.d - a.title.d)
    .slice(0, MAX_CONTENDERS);
}

/**
 * P(best) for the contenders, by resampling the chunks they all have (paired: a chunk number
 * is the same seasons for every move); every other move gets 0. `titleMeans`: per contender,
 * its mean title difference in each chunk.
 */
export function withPBest(
  effects: DeepEffect[],
  contenders: DeepEffect[],
  titleMeans: Map<string, Map<number, number>>,
): DeepEffect[] {
  const outOfReach = () => {
    for (const e of effects) if (e.seasons > 0 && !e.dropped) e.pBest = 0;
  };
  if (contenders.length === 1) {
    outOfReach();
    contenders[0]!.pBest = 1;
    return effects;
  }
  if (contenders.length < 2) return effects;
  const first = titleMeans.get(contenders[0]!.key) ?? new Map<number, number>();
  const shared = [...first.keys()].filter((c) =>
    contenders.every((e) => titleMeans.get(e.key)?.has(c)),
  );
  if (shared.length < 8) return effects;
  outOfReach();
  const means = shared.map((c) => contenders.map((e) => titleMeans.get(e.key)!.get(c)!));
  const wins = new Array<number>(contenders.length).fill(0);
  const draw = rng(shared.length * 31 + contenders.length);
  const B = 2000;
  for (let b = 0; b < B; b++) {
    const total = new Array<number>(contenders.length).fill(0);
    for (let i = 0; i < shared.length; i++) {
      const row = means[Math.floor(draw() * shared.length)]!;
      for (let j = 0; j < row.length; j++) total[j]! += row[j]!;
    }
    let best = 0;
    for (let j = 1; j < total.length; j++) if (total[j]! > total[best]!) best = j;
    wins[best]!++;
  }
  contenders.forEach((e, j) => (e.pBest = wins[j]! / B));
  return effects;
}

/** Each move's effect from the chunks so far (the same as the database's sums give). */
export function combine(chunks: ChunkResult[], keys: string[]): DeepEffect[] {
  const sums = new Map<string, MoveSums>();
  const titleMeans = new Map<string, Map<number, number>>();
  for (const key of keys) {
    const acc = emptySums();
    const byChunk = new Map<number, number>();
    for (const c of chunks) {
      const r = c.moves[key];
      if (!r) continue;
      for (const m of METRICS) {
        acc[m].n += r[m].n;
        acc[m].sum += r[m].sum;
        acc[m].sumsq += r[m].sumsq;
      }
      byChunk.set(c.chunk, r.title.sum / r.title.n);
    }
    sums.set(key, acc);
    titleMeans.set(key, byChunk);
  }
  const effects = effectsFromSums(keys, sums);
  return withPBest(effects, contendersOf(effects), titleMeans);
}

/** The base run's odds for every team (the Outlook), weighted by each chunk's seasons. */
export function combineOutlook(chunks: ChunkResult[]): SimTeamResult[] {
  const total = chunks.reduce((a, c) => a + c.seasons, 0);
  if (!total) return [];
  const byTeam = new Map<number, SimTeamResult>();
  for (const c of chunks)
    for (const t of c.outlook) {
      const w = c.seasons / total;
      const acc = byTeam.get(t.teamId) ?? {
        teamId: t.teamId,
        expWins: 0,
        expPointsFor: 0,
        playoffs: 0,
        seed1: 0,
        bye: 0,
        final: 0,
        champ: 0,
        champBye: 0,
      };
      acc.expWins += w * t.expWins;
      acc.expPointsFor += w * t.expPointsFor;
      acc.playoffs += w * t.playoffs;
      acc.seed1 += w * t.seed1;
      // Chunks from before byes were counted have none: 0 (the job's later chunks have them).
      acc.bye += w * (t.bye ?? 0);
      acc.champBye += w * (t.champBye ?? 0);
      acc.final += w * t.final;
      acc.champ += w * t.champ;
      byTeam.set(t.teamId, acc);
    }
  return [...byTeam.values()];
}

/** The team's own base odds over all chunks. */
export function baseOdds(chunks: ChunkResult[]): Record<Metric, number> & { seasons: number } {
  const seasons = chunks.reduce((a, c) => a + c.seasons, 0);
  const out = { seasons } as Record<Metric, number> & { seasons: number };
  for (const m of METRICS)
    out[m] = seasons ? chunks.reduce((a, c) => a + c.base[m], 0) / seasons : 0;
  return out;
}
