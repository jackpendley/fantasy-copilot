// "Vs last season" (Trends): each player's fantasy points per game now against his most recent
// full prior season (at least 40 games, looking back up to two seasons), with minutes, true
// shooting, usage and per-36 production then and now. Pure.

import { STAT_BY_ID, type RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, type ScoringMap } from "@fantasy-copilot/fantasy-core";

/** A prior season as stored (season totals). */
export interface SeasonLine {
  id: number;
  name: string;
  gp: number;
  /** Season totals by stat abbreviation (MIN is total minutes). */
  totals: Record<string, number>;
}

/** A baseline needs this many games; fewer and the season before is tried. */
export const MIN_BASELINE_GAMES = 40;
/** This season's sample before a comparison is shown. */
export const MIN_GAMES_NOW = 5;
/** A minutes change this big gets a role badge. */
export const ROLE_MINUTES = 6;

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Season totals (actual, full season) from ESPN's season pool (fetchSeasonPool). */
export function parseSeasonTotals(raw: any, season: number): SeasonLine[] {
  const out: SeasonLine[] = [];
  for (const e of raw?.players ?? []) {
    const p = e.player ?? e.playerPoolEntry?.player;
    const s = (p?.stats ?? []).find(
      (x: any) => x.statSourceId === 0 && x.statSplitTypeId === 0 && x.seasonId === season,
    );
    if (!p || !s?.stats) continue;
    const totals: Record<string, number> = {};
    for (const [id, v] of Object.entries(s.stats as Record<string, number>)) {
      const k = STAT_BY_ID[Number(id)];
      // Rates (FG%...) don't add up: totals only.
      if (k && !k.endsWith("%") && Number.isFinite(v)) totals[k] = v;
    }
    // Misses, when the league scores them and ESPN only sends makes and attempts (linear, so
    // fine on totals; double-doubles are counted per game by ESPN itself).
    for (const [miss, a, m] of [
      ["FGMI", "FGA", "FGM"],
      ["FTMI", "FTA", "FTM"],
      ["3PMI", "3PA", "3PM"],
    ] as const)
      if (totals[miss] == null && totals[a] != null && totals[m] != null)
        totals[miss] = totals[a] - totals[m];
    const gp = totals.GP ?? 0;
    if (gp > 0) out.push({ id: p.id, name: p.fullName, gp, totals });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** True shooting: points per two shooting possessions. */
const trueShooting = (pts: number, fga: number, fta: number) => {
  const att = 2 * (fga + 0.44 * fta);
  return att > 0 ? pts / att : null;
};

export interface SeasonRates {
  season: number;
  games: number;
  fppg: number;
  minutes: number;
  ts: number | null;
  /** Fantasy points per 36 minutes. */
  per36: number | null;
}

/** A prior season's per-game rates under this league's scoring. */
export function ratesOf(line: SeasonLine, season: number, scoring: ScoringMap): SeasonRates {
  const per = Object.fromEntries(Object.entries(line.totals).map(([k, v]) => [k, v / line.gp]));
  const fppg = fantasyPoints(per, scoring);
  const minutes = (line.totals.MIN ?? 0) / line.gp;
  return {
    season,
    games: line.gp,
    fppg,
    minutes,
    ts: trueShooting(line.totals.PTS ?? 0, line.totals.FGA ?? 0, line.totals.FTA ?? 0),
    per36: minutes > 0 ? (fppg * 36) / minutes : null,
  };
}

/** This season's rates from ESPN's season averages (applied FP/G, average stats). */
export function currentRates(p: RosterPlayer, season: number): SeasonRates | null {
  const s = p.season;
  const games = s?.stats.GP ?? 0;
  if (!s || s.avg == null || games <= 0) return null;
  const minutes = s.stats.MIN ?? 0;
  return {
    season,
    games,
    fppg: s.avg,
    minutes,
    ts: trueShooting(s.stats.PTS ?? 0, s.stats.FGA ?? 0, s.stats.FTA ?? 0),
    per36: minutes > 0 ? (s.avg * 36) / minutes : null,
  };
}

/**
 * The season he's compared with: the most recent prior one with at least MIN_BASELINE_GAMES,
 * looking back through `seasons` (newest first). Null when none has enough.
 */
export function pickBaseline(
  id: number,
  seasons: { season: number; lines: Map<number, SeasonLine> }[],
): { season: number; line: SeasonLine } | null {
  for (const s of seasons) {
    const line = s.lines.get(id);
    if (line && line.gp >= MIN_BASELINE_GAMES) return { season: s.season, line };
  }
  return null;
}

export interface VsLastSeason<T> {
  entry: T;
  now: SeasonRates;
  then: SeasonRates;
  delta: number;
  /** "bigger" or "smaller" when his minutes moved by ROLE_MINUTES or more. */
  role: "bigger" | "smaller" | null;
}

/**
 * Risers and fallers by FP/G against each player's baseline season (players with at least
 * MIN_GAMES_NOW games this season and a baseline).
 */
export function vsLastSeason<T extends { player: RosterPlayer }>(
  entries: T[],
  seasons: { season: number; lines: Map<number, SeasonLine> }[],
  scoring: ScoringMap,
  current: number,
  n = 8,
): { risers: VsLastSeason<T>[]; fallers: VsLastSeason<T>[] } {
  const rows: VsLastSeason<T>[] = [];
  for (const entry of entries) {
    const now = currentRates(entry.player, current);
    if (!now || now.games < MIN_GAMES_NOW) continue;
    const base = pickBaseline(entry.player.id, seasons);
    if (!base) continue;
    const then = ratesOf(base.line, base.season, scoring);
    const dMin = now.minutes - then.minutes;
    rows.push({
      entry,
      now,
      then,
      delta: now.fppg - then.fppg,
      role: dMin >= ROLE_MINUTES ? "bigger" : dMin <= -ROLE_MINUTES ? "smaller" : null,
    });
  }
  const sorted = [...rows].sort((a, b) => b.delta - a.delta);
  return {
    risers: sorted.filter((r) => r.delta > 0).slice(0, n),
    fallers: sorted
      .filter((r) => r.delta < 0)
      .reverse()
      .slice(0, n),
  };
}
