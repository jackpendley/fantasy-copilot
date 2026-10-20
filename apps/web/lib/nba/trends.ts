// League-wide signals: who's running hot or cold against projection, which free agents
// ESPN managers are adding, and free agents who gain minutes when a teammate is out.

import type { FreeAgent, RosterPlayer } from "@fantasy-copilot/espn";
import { normalizeStatus } from "@fantasy-copilot/fantasy-core";
import type { InjuryReport } from "@fantasy-copilot/nba-data";
import { perGameProjection } from "./projection";

export interface PoolPlayer {
  player: RosterPlayer;
  /** Fantasy team name, "Free agent" or "Waivers". */
  owner: string;
  mine: boolean;
  available: boolean;
}

export interface HotCold {
  entry: PoolPlayer;
  recent: number;
  baseline: number;
  delta: number;
  games: number;
}

/** Last-7-day average vs projection, for players with at least `minGames` games in that window. */
export function hotAndCold(pool: PoolPlayer[], minGames = 2, n = 8) {
  const rows: HotCold[] = [];
  for (const e of pool) {
    const w = e.player.last7;
    const games = w?.avg && w.total ? Math.round(w.total / w.avg) : 0;
    if (games < minGames || w?.avg == null) continue;
    const baseline = e.player.projection?.avg ?? perGameProjection(e.player).fppg;
    if (!baseline) continue;
    rows.push({ entry: e, recent: w.avg, baseline, delta: w.avg - baseline, games });
  }
  return {
    hot: [...rows]
      .sort((a, b) => b.delta - a.delta)
      .slice(0, n)
      .filter((r) => r.delta > 0),
    cold: [...rows]
      .sort((a, b) => a.delta - b.delta)
      .slice(0, n)
      .filter((r) => r.delta < 0),
  };
}

/** Free agents gaining the most ownership across ESPN this week. */
export function ownershipRisers(freeAgents: FreeAgent[], n = 10) {
  return freeAgents
    .filter((f) => (f.player.percentChange ?? 0) > 0)
    .sort((a, b) => (b.player.percentChange ?? 0) - (a.player.percentChange ?? 0))
    .slice(0, n);
}

const GROUPS: Record<string, string> = { PG: "G", SG: "G", SF: "F", PF: "F", C: "C" };
const groups = (p: RosterPlayer) => new Set(p.positions.map((x) => GROUPS[x]).filter(Boolean));

export interface Opening {
  proTeam: string;
  /** Key players ruled out on this NBA team, best first. */
  outs: { player: RosterPlayer; note: string | null }[];
  beneficiaries: FreeAgent[];
}

/**
 * NBA teams with key players ruled out (projected >= `minFppg`), and the healthy free agents on
 * that team who share a position group with one of them: those minutes have to go somewhere.
 */
export function injuryOpenings(
  everyone: RosterPlayer[],
  injuries: InjuryReport[],
  freeAgents: FreeAgent[],
  minFppg = 28,
): Opening[] {
  const notes = new Map(injuries.map((i) => [i.playerId, i]));
  const fp = (p: RosterPlayer) => perGameProjection(p).fppg;
  const byTeam = new Map<number, RosterPlayer[]>();
  for (const p of everyone) {
    const s = normalizeStatus(notes.get(p.id)?.status ?? p.injuryStatus);
    if ((s === "OUT" || s === "INJURY_RESERVE") && fp(p) >= minFppg)
      byTeam.set(p.proTeamId, [...(byTeam.get(p.proTeamId) ?? []), p]);
  }
  const openings: Opening[] = [];
  for (const [pro, outs] of byTeam) {
    const g = new Set(outs.flatMap((p) => [...groups(p)]));
    const ids = new Set(outs.map((p) => p.id));
    const beneficiaries = freeAgents
      .filter(
        (f) =>
          f.player.proTeamId === pro &&
          !ids.has(f.player.id) &&
          normalizeStatus(f.player.injuryStatus) === "ACTIVE" &&
          [...groups(f.player)].some((x) => g.has(x)),
      )
      .sort((a, b) => fp(b.player) - fp(a.player))
      .slice(0, 3);
    if (!beneficiaries.length) continue;
    outs.sort((a, b) => fp(b) - fp(a));
    openings.push({
      proTeam: outs[0]!.proTeam,
      outs: outs.map((p) => ({ player: p, note: notes.get(p.id)?.short ?? null })),
      beneficiaries,
    });
  }
  return openings.sort((a, b) => fp(b.outs[0]!.player) - fp(a.outs[0]!.player));
}
