// What a move's card shows while the worker re-checks moves (ADR-058): the current check once
// it has settled, the last settled numbers while a newer check runs for the same roster
// (another team's move, news, a new day), a partial check after Jack's own roster changed, or a
// loader. Pure.

import { TOP_TIER, type DeepEffect } from "./deep-check";

/**
 * - current: the check for the rosters as they are now, settled.
 * - updating: the last settled numbers for these players; a newer check is running (another
 *   team's move, news, a new day).
 * - stale: the last numbers for these players, from before their latest news; no check is
 *   running yet.
 * - refining: the running check's numbers so far (enough seasons to show).
 * - loading: no usable numbers yet; a check is running.
 * - none: not checked, and no check is running.
 */
export type ShownState = "current" | "updating" | "stale" | "refining" | "loading" | "none";

/** Same players in the same slots (roster keys differ only in injury news, or not at all)? */
export const samePlayers = (a: string, b: string) => a.split(".")[0] === b.split(".")[0];

export interface Shown {
  state: ShownState;
  effect: DeepEffect | null;
}

/** The latest worker job and its results so far (results only when they're this job's). */
export interface LiveJob {
  id: number;
  rosterKey: string;
  live: boolean;
  final: boolean;
  effects: Map<string, DeepEffect> | null;
}

/** A move's last settled result (move_results). */
export interface SettledResult {
  rosterKey: string;
  effect: DeepEffect;
}

export function chooseShown(
  key: string,
  job: LiveJob | null,
  last: SettledResult | null,
  rosterNow: string,
): Shown {
  const forNow = job != null && job.rosterKey === rosterNow;
  const e = forNow ? (job.effects?.get(key) ?? null) : null;
  if (e && e.seasons > 0 && (!e.active || job!.final)) return { state: "current", effect: e };
  const running = job?.live ?? false;
  if (last && samePlayers(last.rosterKey, rosterNow)) {
    const state = running ? "updating" : last.rosterKey === rosterNow ? "current" : "stale";
    return { state, effect: last.effect };
  }
  if (e && e.seasons >= TOP_TIER.minSeasons) return { state: "refining", effect: e };
  return { state: running ? "loading" : "none", effect: null };
}

/** A move's numbers as the card shows them. */
export interface ShownSim {
  title: { d: number; se: number };
  playoffs: { d: number; se: number };
  seed1: { d: number; se: number };
  wins: { d: number; se: number };
  seasons: number;
  deep: true;
  pBetter: number;
  pBest: number | null;
  /** Still getting seasons. */
  refining: boolean;
  dropped: boolean;
}

/** The worker job as the page's banner shows it. */
export interface JobStatus {
  live: boolean;
  trigger: string | null;
  createdAt: string;
  /** Moves done and in the job. */
  settled: number;
  total: number;
  /** The job is for Jack's roster as it is now (his own move is being checked otherwise). */
  current: boolean;
}

export interface DeepView {
  sims: Record<string, ShownSim>;
  states: Record<string, ShownState>;
  job: JobStatus | null;
}

/** Every key's numbers and state, and the job's status. */
export function deepView(
  keys: string[],
  job:
    (LiveJob & { trigger: string | null; createdAt: Date; settled: number; total: number }) | null,
  last: Map<string, SettledResult>,
  rosterNow: string,
): DeepView {
  const sims: Record<string, ShownSim> = {};
  const states: Record<string, ShownState> = {};
  for (const key of keys) {
    const s = chooseShown(key, job, last.get(key) ?? null, rosterNow);
    states[key] = s.state;
    const e = s.effect;
    if (!e) continue;
    sims[key] = {
      title: e.title,
      playoffs: e.playoffs,
      seed1: e.seed1,
      wins: e.wins,
      seasons: e.seasons,
      deep: true,
      pBetter: e.pBetter,
      pBest: e.pBest,
      refining: s.state === "refining",
      dropped: e.dropped,
    };
  }
  return {
    sims,
    states,
    job: job && {
      live: job.live,
      trigger: job.trigger,
      createdAt: job.createdAt.toISOString(),
      settled: job.settled,
      total: job.total,
      current: samePlayers(job.rosterKey, rosterNow),
    },
  };
}
