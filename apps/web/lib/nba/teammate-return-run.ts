import "server-only";
// The nightly refresh of teammate-return effects (lib/nba/teammate-return.ts, ADR-064): ESPN's
// public game logs for each regular who has missed 5+ team games this season and for his
// position-mates in the league's player pool, stored in view_cache (a few hundred bytes).
// Pages and jobs attach the stored effects to players as they load the league (lib/nba/data.ts).

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import { fetchGameLog } from "@fantasy-copilot/nba-data";
import { dbConfigured } from "../db";
import { readSinceNightly } from "../nightly-fresh";
import { readView, viewStamp, writeView } from "../view-cache";
import {
  ADJUSTING,
  groupOf,
  latestAbsence,
  returnsStale,
  teammateEffects,
  type LogGame,
  type TeammateEffect,
} from "./teammate-return";

const KEY = "teammate-returns";
/** A candidate regular: this many minutes (season or ESPN's projection). */
const CANDIDATE_MIN = 20;
/** Logs fetched a few at a time (ESPN's site API refuses bursts). */
const BATCH = 4;
/** No stored effects yet: looked for again this often (the gameday run computes missing ones). */
const EMPTY_TTL_MS = 10 * 60_000;

let cached: { at: number; effects: Promise<TeammateEffect[]>; empty?: boolean } | null = null;

/** The stored effects (none without a database, or before the first nightly run). */
export function teammateReturnEffects(): Promise<TeammateEffect[]> {
  // Off: effects stored before the switch aren't applied either.
  if (!ADJUSTING || !dbConfigured()) return Promise.resolve([]);
  // Computed nightly: read once after each nightly run (lib/nightly-fresh.ts).
  if (
    cached &&
    (cached.empty ? Date.now() - cached.at < EMPTY_TTL_MS : readSinceNightly(cached.at))
  )
    return cached.effects;
  const entry: NonNullable<typeof cached> = { at: Date.now(), effects: Promise.resolve([]) };
  entry.effects = readView<TeammateEffect[]>(KEY)
    .then((v) => v?.value ?? [])
    .catch(() => [])
    .then((effects) => ((entry.empty = !effects.length), effects));
  cached = entry;
  return entry.effects;
}

/**
 * Recompute and store the effects as of scoring period `today` from every player in the
 * league's pool (rosters and free agents). Returns what it found, for the job log.
 */
export async function refreshTeammateReturns(...args: Parameters<typeof computeTeammateReturns>) {
  const t0 = performance.now();
  const { effects, ...found } = await computeTeammateReturns(...args);
  await writeView(KEY, String(args[3]), effects, performance.now() - t0);
  cached = null;
  return {
    ...found,
    effects: effects.map((e) => `${e.player}<-${e.teammate} ${(-e.lambda * e.gap).toFixed(1)}`),
  };
}

/** The day this instance last checked whether the stored effects are due (one look a day). */
let dueChecked: string | null = null;

/**
 * Whether the stored effects are missing or over a day old, so a gameday run computes them
 * (the first day after a deploy, or a nightly that failed). Looked at once per instance a day.
 */
export async function teammateReturnsDue(ymd: string): Promise<boolean> {
  if (!ADJUSTING || !dbConfigured() || dueChecked === ymd) return false;
  dueChecked = ymd;
  return returnsStale((await viewStamp(KEY))?.computedAt ?? null);
}

/** The effects as of scoring period `today` (no database). */
export async function computeTeammateReturns(
  players: RosterPlayer[],
  games: ProGame[],
  scoring: ScoringMap,
  today: number,
  season = Number(process.env.ESPN_SEASON || 2027),
) {
  const spOf = new Map(games.map((g) => [g.gameId, g.scoringPeriodId]));
  const teamGames = new Map<number, number[]>();
  for (const g of games)
    if (g.scoringPeriodId < today)
      for (const t of [g.homeProTeamId, g.awayProTeamId])
        teamGames.set(t, [...(teamGames.get(t) ?? []), g.scoringPeriodId]);
  for (const list of teamGames.values()) list.sort((a, b) => a - b);

  const unique = [...new Map(players.map((p) => [p.id, p])).values()];
  const logs = new Map<number, LogGame[]>();
  const fetchLogs = async (ids: number[]) => {
    for (let i = 0; i < ids.length; i += BATCH)
      await Promise.all(
        ids.slice(i, i + BATCH).map(async (id) => {
          const log = await fetchGameLog(id, season).catch(() => null);
          if (!log) return;
          logs.set(
            id,
            log
              .filter((g) => g.part === "regular" && (g.line.MIN ?? 0) > 0 && spOf.has(g.gameId))
              .map((g) => ({
                sp: spOf.get(g.gameId)!,
                min: g.line.MIN ?? 0,
                fp: fantasyPoints(withDerived(g.line), scoring),
              }))
              .filter((g) => g.sp < today)
              .sort((a, b) => a.sp - b.sp),
          );
        }),
      );
  };

  // Regulars who have missed 5+ of their team's games (by season games played), then those whose
  // log shows 5 straight, then their position-mates.
  const gamesPlayed = (p: RosterPlayer) =>
    p.season?.avg && p.season.total ? Math.round(p.season.total / p.season.avg) : 0;
  const candidates = unique.filter(
    (p) =>
      groupOf(p) &&
      Math.max(p.season?.stats?.MIN ?? 0, p.projection?.stats?.MIN ?? 0) >= CANDIDATE_MIN &&
      (teamGames.get(p.proTeamId)?.length ?? 0) - gamesPlayed(p) >= 5,
  );
  await fetchLogs(candidates.map((p) => p.id));
  const absent = candidates.filter((t) => {
    const log = logs.get(t.id);
    const schedule = teamGames.get(t.proTeamId);
    return log?.length && schedule && latestAbsence(new Set(log.map((g) => g.sp)), schedule);
  });
  const mates = unique.filter(
    (p) =>
      !logs.has(p.id) &&
      absent.some((t) => t.proTeamId === p.proTeamId && groupOf(t) === groupOf(p) && t.id !== p.id),
  );
  await fetchLogs(mates.map((p) => p.id));

  const effects = teammateEffects(
    unique.filter((p) => logs.has(p.id)),
    logs,
    teamGames,
  );
  return {
    candidates: candidates.length,
    absences: absent.length,
    logsFetched: logs.size,
    effects,
  };
}
