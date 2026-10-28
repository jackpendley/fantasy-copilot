import "server-only";
// Collect market data for the model: sportsbook props and game lines before each tip, and a
// daily DARKO snapshot. Pages read today's props live (cached in memory for 15 minutes).

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { fantasyPoints, withDerived } from "@fantasy-copilot/fantasy-core";
import {
  buildMatcher,
  darkoPerGame,
  fetchDarko,
  fetchGameSummary,
  fetchPropBets,
  fetchScoreboard,
  parseBoxScore,
  type PropLine,
} from "@fantasy-copilot/nba-data";
import { db } from "@/lib/db";
import { gameEnvironment, perGameProjection, type GameLine } from "./projection";
import { vegasProjection } from "./vegas";

export type Snapshot = "morning" | "pregame" | "close";

const CACHE_MS = 15 * 60_000;
const propsCache = new Map<number, { at: number; lines: PropLine[] }>();

/** Today's props per player (games that haven't posted props yet are just missing). */
export async function propsForGames(gameIds: number[]): Promise<Map<number, PropLine[]>> {
  const lists = await Promise.all(
    gameIds.map(async (id) => {
      const hit = propsCache.get(id);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.lines;
      const lines = await fetchPropBets(id).catch(() => []);
      propsCache.set(id, { at: Date.now(), lines });
      return lines;
    }),
  );
  const byPlayer = new Map<number, PropLine[]>();
  for (const l of lists.flat()) {
    if (!byPlayer.has(l.playerId)) byPlayer.set(l.playerId, []);
    byPlayer.get(l.playerId)!.push(l);
  }
  return byPlayer;
}

/** Who we project and how: players by id (with ESPN's projected box score) and the scoring. */
export interface ProjectionContext {
  players: Map<number, RosterPlayer>;
  scoring: Record<string, number>;
  /** Scoring period of these games (the projection's as-of day). */
  sp: number;
}

/**
 * Store props and game lines for `games` that haven't tipped, plus our projection and the
 * props-implied one for every player with lines (for the walk-forward test). 'close'
 * overwrites itself on every run (the last capture before tip); the other snapshots keep
 * their first capture.
 */
export async function collectMarketData(
  games: ProGame[],
  yyyymmdd: string,
  snapshot: Snapshot,
  now = new Date(),
  projections?: ProjectionContext,
): Promise<{ games: number; props: number }> {
  const board = await fetchScoreboard(yyyymmdd);
  const pre = games.filter((g) => {
    const s = board.find((b) => b.gameId === g.gameId);
    return (s ? s.state === "pre" : true) && g.date > now.getTime();
  });
  let props = 0;
  for (const g of pre) {
    const lines = await fetchPropBets(g.gameId).catch(() => []);
    const tip = new Date(g.date);
    if (lines.length) {
      const rows = lines.map((l) => ({
        game_id: g.gameId,
        player_id: l.playerId,
        market: l.market,
        snapshot,
        captured_at: now,
        tip,
        line: l.line,
        over_price: l.over,
        under_price: l.under,
        open_line: l.openLine,
        book_updated_at: l.updatedAt ? new Date(l.updatedAt) : null,
      }));
      const cols = [
        "game_id",
        "player_id",
        "market",
        "snapshot",
        "captured_at",
        "tip",
        "line",
        "over_price",
        "under_price",
        "open_line",
        "book_updated_at",
      ] as const;
      await (snapshot === "close"
        ? db()`
            insert into prop_lines ${db()(rows, ...cols)}
            on conflict (game_id, player_id, market, snapshot) do update set
              captured_at = excluded.captured_at, line = excluded.line,
              over_price = excluded.over_price, under_price = excluded.under_price,
              open_line = excluded.open_line, book_updated_at = excluded.book_updated_at
          `
        : db()`insert into prop_lines ${db()(rows, ...cols)} on conflict do nothing`);
      props += rows.length;
    }
    // Our projection (and ESPN's, and Vegas' where posted) for everyone playing in this game.
    if (projections) {
      const line = board.find((b) => b.gameId === g.gameId);
      await storeProjections(g, line, lines, projections, snapshot, now);
    }
    const s = board.find((b) => b.gameId === g.gameId);
    if (s && (s.spread != null || s.total != null)) {
      const row = {
        game_id: g.gameId,
        snapshot,
        captured_at: now,
        tip,
        home_team: g.homeProTeamId,
        away_team: g.awayProTeamId,
        spread: s.spread,
        total: s.total,
      };
      await (snapshot === "close"
        ? db()`
            insert into game_lines ${db()(row)}
            on conflict (game_id, snapshot) do update set
              captured_at = excluded.captured_at, spread = excluded.spread, total = excluded.total
          `
        : db()`insert into game_lines ${db()(row)} on conflict do nothing`);
    }
  }
  return { games: pre.length, props };
}

/**
 * Save today's DARKO projections, matched to ESPN ids by name (then team). Skipped when
 * DARKO hasn't published a new as-of date since the last snapshot.
 */
export async function snapshotDarko(players: RosterPlayer[]) {
  const { asOf, players: darko } = await fetchDarko();
  if (!asOf) return { darko: "no data" };
  const seen = await db()`
    select 1 from projection_snapshots where source = 'darko' and as_of = ${asOf} limit 1
  `;
  if (seen.length) return { darko: `already have ${asOf}` };
  const match = buildMatcher(players.map((p) => ({ id: p.id, name: p.name, team: p.proTeam })));
  const rows = darko
    .map((d) => ({ d, id: match(d.name, "") }))
    .filter((x) => x.id != null)
    .map(({ d, id }) => ({
      source: "darko",
      as_of: asOf,
      player_id: id!,
      payload: db().json({ nbaId: d.nbaId, team: d.team, perGame: darkoPerGame(d) } as never),
    }));
  if (rows.length) {
    await db()`
      insert into projection_snapshots ${db()(rows, "source", "as_of", "player_id", "payload")}
      on conflict do nothing
    `;
  }
  return { darko: asOf, matched: rows.length, of: darko.length };
}

async function storeProjections(
  g: ProGame,
  board: GameLine | undefined,
  lines: PropLine[],
  ctx: ProjectionContext,
  snapshot: Snapshot,
  now: Date,
) {
  const byPlayer = new Map<number, PropLine[]>();
  for (const l of lines) byPlayer.set(l.playerId, [...(byPlayer.get(l.playerId) ?? []), l]);
  const rows = [];
  for (const p of ctx.players.values()) {
    if (p.proTeamId !== g.homeProTeamId && p.proTeamId !== g.awayProTeamId) continue;
    const base = perGameProjection(p, ctx.sp).fppg;
    if (base <= 0) continue;
    const env = gameEnvironment(board, p.proTeamId === g.homeProTeamId);
    const props = byPlayer.get(p.id) ?? [];
    rows.push({
      game_id: g.gameId,
      player_id: p.id,
      snapshot,
      captured_at: now,
      tip: new Date(g.date),
      model_fppg: base * env,
      vegas_fppg: vegasProjection(props, p.projection?.stats, base, ctx.scoring)?.fppg ?? null,
      espn_fppg: p.projection?.avg ?? null,
    });
  }
  if (!rows.length) return;
  const cols = [
    "game_id",
    "player_id",
    "snapshot",
    "captured_at",
    "tip",
    "model_fppg",
    "vegas_fppg",
    "espn_fppg",
  ] as const;
  await (snapshot === "close"
    ? db()`
        insert into pregame_projections ${db()(rows, ...cols)}
        on conflict (game_id, player_id, snapshot) do update set
          captured_at = excluded.captured_at, model_fppg = excluded.model_fppg,
          vegas_fppg = excluded.vegas_fppg
      `
    : db()`insert into pregame_projections ${db()(rows, ...cols)} on conflict do nothing`);
}

/** Box scores of finished games, scored with the league's settings (bonuses included). */
export async function recordResults(games: ProGame[], scoring: Record<string, number>) {
  let rows = 0;
  for (const g of games) {
    const summary = await fetchGameSummary(g.gameId).catch(() => null);
    if (summary?.header?.competitions?.[0]?.status?.type?.state !== "post") continue;
    const lines = parseBoxScore(summary);
    if (!lines.length) continue;
    await db()`
      insert into game_results ${db()(
        lines.map((l) => ({
          game_id: g.gameId,
          player_id: l.playerId,
          team_id: l.teamId,
          line: db().json(l.line as never),
          fp: fantasyPoints(withDerived(l.line), scoring),
        })),
        "game_id",
        "player_id",
        "team_id",
        "line",
        "fp",
      )}
      on conflict do nothing
    `;
    rows += lines.length;
  }
  return { results: rows };
}
