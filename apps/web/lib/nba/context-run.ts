import "server-only";
// The nightly context step (lib/nba/context.ts, ADR-069): from this season's box scores
// (game_participation, game_results; ADR-068), who was out of every team-game, what each of a
// player's games loses at full strength, and each team's regulars with their shares. Stored
// gzipped in view_cache (one read per nightly run by each instance); pages and jobs attach it
// to players as they load the league (lib/nba/data.ts).

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { dbConfigured, db } from "../db";
import { pack, unpack } from "../gz";
import { readSinceNightly } from "../nightly-fresh";
import { readView, viewStamp, writeView } from "../view-cache";
import {
  absencesByGame,
  othersNow,
  pastAdjustments,
  regularsNow,
  type Appearance,
  type ContextPayload,
} from "./context";
import { groupOf } from "./teammate-return";

const KEY = "context";
/**
 * Whether players carry the context (pages, jobs, the simulations). The nightly computes it
 * either way, so the stored one can be checked before it's switched on: on only once the
 * re-run on the full shipped stack passes (MODEL_CARD, Nov 20; Jack, Nov 19).
 */
export const CONTEXT_ON = true;
/** No stored context yet: looked for again this often (the gameday run computes it if due). */
const EMPTY_TTL_MS = 10 * 60_000;
/** A gameday run computes the context when the stored one is older than this. */
const STALE_MS = 26 * 3600_000;

/**
 * Recorded games may lag the schedule by this share (a summary ESPN never serves); beyond it the
 * context waits for the nightly catch-up (lib/nba/market-data.ts).
 */
const MISSING_OK = 0.02;

/**
 * Compute the context from this season's recorded games before `today` (scoring period); null
 * while too many finished games aren't recorded yet.
 */
export async function computeContext(
  games: ProGame[],
  pool: RosterPlayer[],
  today: number,
): Promise<ContextPayload | null> {
  const past = games.filter((g) => g.scoringPeriodId < today);
  const byId = new Map(past.map((g) => [g.gameId, g]));
  const rows = past.length
    ? await db()<
        { game_id: string; player_id: number; team_id: number; fp: number; min: number }[]
      >`
        select p.game_id, p.player_id, p.team_id, r.fp, coalesce((r.line->>'MIN')::float, 0) as min
        from game_participation p join game_results r using (game_id, player_id)
        where p.played and p.game_id in ${db()(past.map((g) => g.gameId))}
      `
    : [];
  const recorded = new Set(rows.map((r) => Number(r.game_id)));
  if (past.filter((g) => !recorded.has(g.gameId)).length > MISSING_OK * past.length) return null;
  const logs = new Map<number, (Appearance & { game: number; sp: number })[]>();
  for (const r of rows) {
    const g = byId.get(Number(r.game_id))!;
    const list = logs.get(r.player_id) ?? [];
    list.push({
      side: `${g.gameId}:${r.team_id}`,
      team: String(r.team_id),
      t: g.date,
      fp: r.fp,
      min: r.min,
      game: g.gameId,
      sp: g.scoringPeriodId,
    });
    logs.set(r.player_id, list);
  }
  for (const list of logs.values()) list.sort((a, b) => a.t - b.t);

  const players = new Map(pool.map((p) => [p.id, p]));
  const group = (id: number) => {
    const p = players.get(id);
    return p ? groupOf(p) : null;
  };
  const sp = new Map([...logs.values()].flat().map((g) => [g.game, g.sp]));
  const adj: ContextPayload["adj"] = {};
  for (const [id, list] of pastAdjustments(logs, absencesByGame(logs, group), group))
    adj[id] = list.map((a) => [a.game, sp.get(a.game)!, a.factor, a.fp, a.min]);
  const regulars: ContextPayload["regulars"] = {};
  const now = regularsNow(logs, group, Date.now());
  for (const [team, regs] of now)
    regulars[team] = regs.map((r) => ({ ...r, name: players.get(r.player)?.name ?? "" }));
  const others = Object.fromEntries(othersNow(logs, now, Date.now()));
  return { asOf: today, adj, regulars, others };
}

/** Recompute and store the context; returns counts for the job log. */
export async function refreshContext(games: ProGame[], pool: RosterPlayer[], today: number) {
  const t0 = performance.now();
  const value = await computeContext(games, pool, today);
  if (!value) return { waiting: "finished games not recorded yet" };
  await writeView(KEY, String(today), { gz: pack(value) }, performance.now() - t0);
  cached = null;
  return {
    players: Object.keys(value.adj).length,
    adjustedGames: Object.values(value.adj).reduce((a, l) => a + l.length, 0),
    teams: Object.keys(value.regulars).length,
  };
}

let cached: { at: number; value: Promise<ContextPayload | null>; empty?: boolean } | null = null;

/** The stored context (null without a database, or before the first run). */
export function storedContext(): Promise<ContextPayload | null> {
  if (!CONTEXT_ON || !dbConfigured()) return Promise.resolve(null);
  if (
    cached &&
    (cached.empty ? Date.now() - cached.at < EMPTY_TTL_MS : readSinceNightly(cached.at))
  )
    return cached.value;
  const entry: NonNullable<typeof cached> = { at: Date.now(), value: Promise.resolve(null) };
  entry.value = readView<{ gz: string }>(KEY)
    .then((v) => (v ? unpack<ContextPayload>(v.value.gz) : null))
    .catch(() => null)
    .then((value) => ((entry.empty = !value), value));
  cached = entry;
  return entry.value;
}

/** The day this instance last checked whether the stored context is due (one look a day). */
let dueChecked: string | null = null;

/** Whether the stored context is missing or over a day old (looked at once per instance a day). */
export async function contextDue(ymd: string): Promise<boolean> {
  if (!dbConfigured() || dueChecked === ymd) return false;
  dueChecked = ymd;
  const stamp = await viewStamp(KEY);
  return !stamp || Date.now() - stamp.computedAt.getTime() > STALE_MS;
}
