// A player's context factor on a day (ADR-069), apart from lib/nba/context.ts: the season
// simulations' task runner bundles this with only packages/fantasy-core and apps/web/lib checked
// out (.github/workflows/simulate.yml), so it imports no other package. Pure.

/** A player's context as attached (RosterPlayer.context). */
export interface PlayerContext {
  adj: [number, number, number, number, number][];
  days: { day: number; factor: number; out: string[] }[];
}

/** His factor on scoring period `sp` (1 without a context, or before its first day). */
export function factorOn(p: { context?: PlayerContext }, sp: number): number {
  let f = 1;
  for (const d of p.context?.days ?? []) if (d.day <= sp) f = d.factor;
  return f;
}
