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

/** Stop a move once its title change is known to ±0.5 points (two standard errors)... */
export const TARGET_TITLE_2SE = 0.005;
/** ...but not before this many seasons, and never past this many. */
export const MIN_SEASONS = 4_000;
export const MAX_SEASONS = 20_000;
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

/** Should a move get more seasons? */
export function needsMore(e: Pick<DeepEffect, "seasons" | "title" | "wins">): {
  more: boolean;
  dropped: boolean;
} {
  if (e.seasons >= MAX_SEASONS) return { more: false, dropped: false };
  if (e.seasons < MIN_SEASONS) return { more: true, dropped: false };
  const worse = (x: Delta) => x.d + 2 * x.se < 0;
  if (worse(e.title) && worse(e.wins)) return { more: false, dropped: true };
  return { more: 2 * e.title.se > TARGET_TITLE_2SE, dropped: false };
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

/**
 * Each move's effect from the chunks so far. P(best) resamples the chunks every candidate
 * shares (the moves still in the running), so the comparison stays paired.
 */
export function combine(chunks: ChunkResult[], keys: string[]): DeepEffect[] {
  const effects = keys.map((key) => {
    const sums = Object.fromEntries(
      METRICS.map((m) => [m, { n: 0, sum: 0, sumsq: 0 } as MetricSums]),
    ) as Record<Metric, MetricSums>;
    for (const c of chunks) {
      const r = c.moves[key];
      if (!r) continue;
      for (const m of METRICS) {
        sums[m].n += r[m].n;
        sums[m].sum += r[m].sum;
        sums[m].sumsq += r[m].sumsq;
      }
    }
    const e = {
      key,
      seasons: sums.title.n,
      title: deltaOf(sums.title),
      playoffs: deltaOf(sums.playoffs),
      seed1: deltaOf(sums.seed1),
      bye: deltaOf(sums.bye),
      wins: deltaOf(sums.wins),
    };
    const next = needsMore(e);
    return {
      ...e,
      pBetter: e.title.se > 0 ? normalCdf(e.title.d / e.title.se) : e.title.d > 0 ? 1 : 0,
      pBest: null as number | null,
      active: next.more,
      dropped: next.dropped,
    };
  });

  // P(best) among the moves not dropped, over the chunks they all have.
  const contenders = effects.filter((e) => !e.dropped && e.seasons > 0);
  const shared = chunks.filter((c) => contenders.every((e) => c.moves[e.key]));
  if (contenders.length > 1 && shared.length >= 8) {
    const means = shared.map((c) =>
      contenders.map((e) => c.moves[e.key]!.title.sum / c.moves[e.key]!.title.n),
    );
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
  } else if (contenders.length === 1) {
    contenders[0]!.pBest = 1;
  }
  return effects;
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
