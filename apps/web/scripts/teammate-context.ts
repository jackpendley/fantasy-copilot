// Teammate context (MODEL_CARD, teammate absences by impact, Nov 19): every player-game of a
// cached season (scripts/fetch-history.ts), with today's projection as of that day, the
// regulars absent from it (each weighted by his share of the team's fantasy points), and the
// same for each of the player's earlier games. Read-only.
//
// Absent: a teammate with 5+ games this season before the game, his latest for this team,
// 10+ minutes a game over his last 10, who didn't play. A teammate whose next game is for
// another team was traded (in production the roster says so). His share: his FP/G over his
// last 10 games ÷ the team's FP per game over its last 10. All point in time, except that
// who sat tonight is read from the box score (in production, the injury report).

import { readdirSync, readFileSync } from "node:fs";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { perGameProjection } from "../lib/nba/projection";

const CACHE = new URL("../data/local/backtest/", import.meta.url);
/** A player-game is scored once he has this many games this season. */
const MIN_SO = 5;
/** An absent teammate counts with 10+ minutes a game over his last 10 (5+ games). */
const ROTATION_MIN = 10;

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Absent {
  /** His share of the team's fantasy points (last 10 games each). */
  share: number;
  /** Straight team games he has missed, this one included. */
  idx: number;
  group: string | null;
  /** His minutes a game over his last 10. */
  min10: number;
}

export interface PlayerGame {
  season: number;
  player: number;
  group: string | null;
  /** Today's projection (FP/G) as of the game's day, and the fantasy points he scored. */
  base: number;
  fp: number;
  /** Teammates absent tonight. */
  absent: Absent[];
  /** His earlier games this season, each with the teammates absent from it. */
  past: { fp: number; min: number; absent: Absent[] }[];
  prior: { fp: number; min: number; gp: number } | null;
}

/** ESPN's default position id → group (guards, forwards, centers). */
const groupOf = (pos: number | undefined) =>
  pos == null ? null : pos <= 2 ? "G" : pos <= 4 ? "F" : "C";

/** A player as perGameProjection reads him: last season as the projection, these games. */
export function asPlayer(
  prior: PlayerGame["prior"],
  games: { fp: number; min: number }[],
): RosterPlayer {
  const sum = games.reduce((a, g) => a + g.fp, 0);
  return {
    id: 0,
    name: "",
    proTeamId: 0,
    proTeam: "",
    positions: [],
    slot: null,
    injuryStatus: "ACTIVE",
    percentOwned: 0,
    percentChange: 0,
    projection: prior
      ? { avg: prior.fp, total: prior.fp * prior.gp, stats: { MIN: prior.min } }
      : null,
    season: games.length
      ? { avg: sum / games.length, total: sum, stats: { MIN: mean(games.map((g) => g.min)) } }
      : null,
    last7: null,
    last15: null,
    last30: null,
    games: games.map((g, i) => ({ scoringPeriodId: i + 1, points: g.fp, line: { MIN: g.min } })),
  } as unknown as RosterPlayer;
}

interface G {
  side: string;
  t: number;
  fp: number;
  min: number;
}

export function playerGames(season: number, scoring: ScoringMap): PlayerGame[] {
  const fpOf = (g: GameLogEntry) => fantasyPoints(withDerived(g.line), scoring);
  const read = (f: string): GameLogEntry[] => JSON.parse(readFileSync(new URL(f, CACHE), "utf8"));
  const positions = new Map(
    Object.entries(
      JSON.parse(readFileSync(new URL(`positions-${season}.json`, CACHE), "utf8")) as Record<
        string,
        number
      >,
    ).map(([id, pos]) => [Number(id), pos]),
  );
  const files = new Set(readdirSync(CACHE).filter((f) => /^\d+-\d+\.json$/.test(f)));
  const ids = [...new Set([...files].map((f) => Number(f.split("-")[0])))].filter((id) =>
    files.has(`${id}-${season}.json`),
  );
  const logs = new Map<number, G[]>();
  const priors = new Map<number, NonNullable<PlayerGame["prior"]>>();
  // A side's team is what the other side lists as its opponent; its FP is its players' sum.
  const sideTeam = new Map<string, string>();
  const sideFp = new Map<string, number>();
  for (const id of ids) {
    const regular = (s: number) =>
      files.has(`${id}-${s}.json`)
        ? read(`${id}-${s}.json`).filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0)
        : [];
    const cur = regular(season);
    const prev = regular(season - 1);
    if (prev.length)
      priors.set(id, {
        fp: mean(prev.map(fpOf)),
        min: mean(prev.map((g) => g.line.MIN ?? 0)),
        gp: prev.length,
      });
    const gs = cur
      .map((g) => ({
        side: `${g.gameId}:${g.home ? "H" : "A"}`,
        t: Date.parse(g.date),
        fp: fpOf(g),
        min: g.line.MIN ?? 0,
      }))
      .sort((a, b) => a.t - b.t);
    for (const g of cur) sideTeam.set(`${g.gameId}:${g.home ? "A" : "H"}`, g.opponent);
    for (const g of gs) sideFp.set(g.side, (sideFp.get(g.side) ?? 0) + g.fp);
    if (gs.length) logs.set(id, gs);
  }
  // Each team's games in order, and everyone who played for it.
  const schedules = new Map<string, { side: string; t: number }[]>();
  const members = new Map<string, Set<number>>();
  const seen = new Set<string>();
  for (const [id, gs] of logs)
    for (const g of gs) {
      const team = sideTeam.get(g.side);
      if (!team) continue;
      if (!members.has(team)) members.set(team, new Set());
      members.get(team)!.add(id);
      if (seen.has(g.side)) continue;
      seen.add(g.side);
      schedules.set(team, [...(schedules.get(team) ?? []), { side: g.side, t: g.t }]);
    }
  for (const list of schedules.values()) list.sort((a, b) => a.t - b.t);
  const played = new Map([...logs].map(([id, gs]) => [id, new Set(gs.map((g) => g.side))]));
  const teamBefore = (id: number, t: number) => {
    const g = logs.get(id)!.findLast((x) => x.t < t);
    return g && sideTeam.get(g.side);
  };
  const teamAfter = (id: number, t: number) => {
    const g = logs.get(id)!.find((x) => x.t > t);
    return g && sideTeam.get(g.side);
  };

  // Who was absent from each team game.
  const absentAt = new Map<string, Absent[]>();
  for (const [team, schedule] of schedules)
    schedule.forEach((tg, k) => {
      const last10 = schedule.slice(Math.max(0, k - 10), k);
      const out: Absent[] = [];
      absentAt.set(tg.side, out);
      if (last10.length < 5) return;
      const teamFp = mean(last10.map((x) => sideFp.get(x.side) ?? 0));
      for (const id of members.get(team)!) {
        if (played.get(id)!.has(tg.side)) continue;
        const before = logs.get(id)!.filter((g) => g.t < tg.t);
        if (before.length < 5 || teamBefore(id, tg.t) !== team) continue;
        const next = teamAfter(id, tg.t);
        if (next && next !== team) continue;
        const b10 = before.slice(-10);
        const min10 = mean(b10.map((g) => g.min));
        if (min10 < ROTATION_MIN) continue;
        let idx = 0;
        for (let j = k; j >= 0 && !played.get(id)!.has(schedule[j]!.side); j--) idx++;
        out.push({
          share: mean(b10.map((g) => g.fp)) / teamFp,
          idx,
          group: groupOf(positions.get(id)),
          min10,
        });
      }
    });

  const rows: PlayerGame[] = [];
  for (const [p, gs] of logs) {
    const prior = priors.get(p) ?? null;
    for (let i = MIN_SO; i < gs.length; i++) {
      const g = gs[i]!;
      if (!sideTeam.get(g.side)) continue;
      const so = gs.slice(0, i);
      const base = perGameProjection(asPlayer(prior, so)).fppg;
      if (!(base > 0)) continue;
      rows.push({
        season,
        player: p,
        group: groupOf(positions.get(p)),
        base,
        fp: g.fp,
        absent: absentAt.get(g.side) ?? [],
        past: so.map((x) => ({ fp: x.fp, min: x.min, absent: absentAt.get(x.side) ?? [] })),
        prior,
      });
    }
  }
  return rows;
}
