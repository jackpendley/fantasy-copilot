// The draft in hindsight (Players → Draft): our pre-draft rankings (uploaded in Settings) next to
// where ESPN's draft took each player and how he has actually played; how accurate our preseason
// projection was; and the draft Jack's picks would have been knowing what we know now. Pure.

import type { DraftPick, RosterPlayer } from "@fantasy-copilot/espn";
import { nameKey } from "@/lib/name-key";
import { perGameValue, teamValue, weighted, type ValueContext } from "./trade";

/** One row of apps/draft-nba/dist/rankings.csv (the columns the review uses). */
export interface RankingRow {
  rank: number;
  name: string;
  team: string;
  tier: number;
  value: number;
  /** Our preseason projection, FP/G. */
  fppg: number;
}

/** CSV fields, with quoted fields (commas inside quotes) and "" escapes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The rankings CSV: rows with a rank, a name and a projection; anything else is skipped. */
export function parseRankingsCsv(text: string): RankingRow[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [iRank, iName, iTeam, iTier, iValue, iFppg] = [
    "rank",
    "name",
    "team",
    "tier",
    "value",
    "fppg",
  ].map(col);
  if ([iRank, iName, iFppg].some((i) => i! < 0))
    throw new Error("needs rank, name and fppg columns");
  const rows: RankingRow[] = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const num = (i: number | undefined) => (i != null && i >= 0 ? Number(f[i]) : NaN);
    const rank = num(iRank);
    const fppg = num(iFppg);
    const name = (f[iName!] ?? "").trim();
    if (!name || !Number.isFinite(rank) || !Number.isFinite(fppg)) continue;
    rows.push({
      rank,
      name,
      team: iTeam! >= 0 ? (f[iTeam!] ?? "").trim().toUpperCase() : "",
      tier: Number.isFinite(num(iTier)) ? num(iTier) : 0,
      value: Number.isFinite(num(iValue)) ? num(iValue) : 0,
      fppg,
    });
  }
  return rows;
}

/** Each ranking's ESPN player: same name, his team breaking a tie. */
export function matchRankings(
  rows: RankingRow[],
  players: Pick<RosterPlayer, "id" | "name" | "proTeam">[],
): { matched: (RankingRow & { playerId: number })[]; unmatched: RankingRow[] } {
  const byName = new Map<string, Pick<RosterPlayer, "id" | "name" | "proTeam">[]>();
  for (const p of players) {
    const k = nameKey(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p]);
  }
  const matched: (RankingRow & { playerId: number })[] = [];
  const unmatched: RankingRow[] = [];
  const used = new Set<number>();
  for (const r of rows) {
    const same = (byName.get(nameKey(r.name)) ?? []).filter((p) => !used.has(p.id));
    const p = same.find((x) => x.proTeam.toUpperCase() === r.team) ?? same[0];
    if (!p) {
      unmatched.push(r);
      continue;
    }
    used.add(p.id);
    matched.push({ ...r, playerId: p.id });
  }
  return { matched, unmatched };
}

/** A projection needs this many games played before it's judged. */
export const MIN_GAMES_JUDGED = 10;

export interface Accuracy {
  /** Players judged (ranked, with MIN_GAMES_JUDGED games). */
  n: number;
  /** Mean absolute error of our preseason FP/G. */
  mae: number;
  /** The simple baseline on the players it covers: last season's FP/G (this season's scoring). */
  baseline: { n: number; mae: number; oursOnSame: number } | null;
  /** Biggest misses: played above our projection, and below it. */
  over: { playerId: number; name: string; pre: number; actual: number }[];
  under: { playerId: number; name: string; pre: number; actual: number }[];
}

export function draftAccuracy(
  rows: {
    playerId: number;
    name: string;
    pre: number;
    actual: number | null;
    games: number;
    lastSeason: number | null;
  }[],
  misses = 5,
): Accuracy | null {
  const judged = rows.filter(
    (r): r is typeof r & { actual: number } => r.actual != null && r.games >= MIN_GAMES_JUDGED,
  );
  if (!judged.length) return null;
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const withBase = judged.filter(
    (r): r is typeof r & { lastSeason: number } => r.lastSeason != null,
  );
  const byMiss = [...judged].sort((a, b) => b.actual - b.pre - (a.actual - a.pre));
  const pick = (r: (typeof judged)[number]) => ({
    playerId: r.playerId,
    name: r.name,
    pre: r.pre,
    actual: r.actual,
  });
  return {
    n: judged.length,
    mae: mean(judged.map((r) => Math.abs(r.actual - r.pre))),
    baseline: withBase.length
      ? {
          n: withBase.length,
          mae: mean(withBase.map((r) => Math.abs(r.actual - r.lastSeason))),
          oursOnSame: mean(withBase.map((r) => Math.abs(r.actual - r.pre))),
        }
      : null,
    over: byMiss
      .filter((r) => r.actual > r.pre)
      .slice(0, misses)
      .map(pick),
    under: byMiss
      .filter((r) => r.actual < r.pre)
      .reverse()
      .slice(0, misses)
      .map(pick),
  };
}

export interface HindsightPick {
  overall: number;
  round: number;
  playerId: number;
  /** His part of the team's full-season value (points so far as a starter, plus the rest). */
  value: number;
}

export interface Hindsight {
  actual: HindsightPick[];
  hindsight: HindsightPick[];
  actualValue: number;
  hindsightValue: number;
}

/**
 * A roster's full-season value: the rest of the season's starting points (lineup fit, playoff
 * weeks weighted, teamValue) plus the points each player has scored so far, counted at the share
 * of games he'd start on this roster from now on (so a bench player's points don't all count).
 */
export function fullSeasonValue(
  roster: RosterPlayer[],
  ctx: ValueContext,
  soFar: (p: RosterPlayer) => number,
): { total: number; per: Map<number, number> } {
  const v = teamValue(
    roster.map((p) => ({ ...p, slot: "BE" })),
    ctx,
  );
  const per = new Map<number, number>();
  let past = 0;
  for (const p of roster) {
    const u = v.usage.get(p.id);
    const share = u && u.games > 0 ? u.starts / u.games : 1;
    const ros = u ? u.starts * perGameValue(p) : 0;
    past += soFar(p) * share;
    per.set(p.id, soFar(p) * share + ros);
  }
  return { total: weighted(v) + past, per };
}

/**
 * Replay the draft: every other team's picks as they were (and every keeper), and at each of
 * Jack's picks the available player who adds the most full-season value to the team built so
 * far (lineup fit included). `candidates` caps the players tried per pick (the best by raw
 * full-season points) to keep it fast.
 */
export function hindsightDraft(
  order: DraftPick[],
  teamId: number,
  players: Map<number, RosterPlayer>,
  ctx: ValueContext,
  soFar: (p: RosterPlayer) => number,
  rawFull: (p: RosterPlayer) => number,
  candidates = 40,
): Hindsight | null {
  const mine = order.filter((p) => p.teamId === teamId);
  if (!mine.length) return null;
  // Others' picks are fixed: a player they took is gone from his pick on (one Jack takes first
  // just leaves that later pick empty: who they'd have taken instead is unknowable).
  const taken = new Set<number>();
  const pool = [...players.values()].sort((a, b) => rawFull(b) - rawFull(a));
  const roster: RosterPlayer[] = [];
  const picks: { pick: DraftPick; playerId: number }[] = [];
  for (const pick of order) {
    if (pick.teamId !== teamId || pick.keeper) {
      taken.add(pick.playerId);
      if (pick.teamId === teamId && players.has(pick.playerId)) {
        roster.push(players.get(pick.playerId)!);
        picks.push({ pick, playerId: pick.playerId });
      }
      continue;
    }
    const open = pool
      .filter((p) => !taken.has(p.id) && !roster.some((r) => r.id === p.id))
      .slice(0, candidates);
    const base = fullSeasonValue(roster, ctx, soFar).total;
    let best: RosterPlayer | null = null;
    let bestGain = -Infinity;
    for (const p of open) {
      const gain = fullSeasonValue([...roster, p], ctx, soFar).total - base;
      if (gain > bestGain) {
        bestGain = gain;
        best = p;
      }
    }
    if (!best) continue;
    taken.add(best.id);
    roster.push(best);
    picks.push({ pick, playerId: best.id });
  }
  const actualRoster = mine.flatMap((p) => players.get(p.playerId) ?? []);
  const a = fullSeasonValue(actualRoster, ctx, soFar);
  const h = fullSeasonValue(roster, ctx, soFar);
  return {
    actual: mine.map((p) => ({
      overall: p.overall,
      round: p.round,
      playerId: p.playerId,
      value: a.per.get(p.playerId) ?? 0,
    })),
    hindsight: picks.map(({ pick, playerId }) => ({
      overall: pick.overall,
      round: pick.round,
      playerId,
      value: h.per.get(playerId) ?? 0,
    })),
    actualValue: a.total,
    hindsightValue: h.total,
  };
}
