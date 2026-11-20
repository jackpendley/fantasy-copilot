// A player's context factor on a day (ADR-069), apart from lib/nba/context.ts: the season
// simulations' task runner bundles this with only packages/fantasy-core and apps/web/lib checked
// out (.github/workflows/simulate.yml), so it imports no other package. Pure.

/** A teammate counted as out, and what says so. */
export interface OutTeammate {
  name: string;
  /** NBA.com's inactive list or the official report (tonight), else ESPN. */
  source: "NBA.com" | "official report" | "ESPN";
  /** ESPN's estimated return date ("2026-11-27"), when it gives one. */
  back: string | null;
}

/** A teammate listed out who isn't counted, and why. */
export interface SkippedTeammate {
  name: string;
  reason: string;
}

/** A player's context as attached (RosterPlayer.context). */
export interface PlayerContext {
  adj: [number, number, number, number, number][];
  days: { day: number; factor: number; out: OutTeammate[] }[];
  /** Teammates listed out today who don't count (too few games or minutes, a small share). */
  skipped?: SkippedTeammate[];
}

/** His factor on scoring period `sp` (1 without a context, or before its first day). */
export function factorOn(p: { context?: PlayerContext }, sp: number): number {
  let f = 1;
  for (const d of p.context?.days ?? []) if (d.day <= sp) f = d.factor;
  return f;
}
