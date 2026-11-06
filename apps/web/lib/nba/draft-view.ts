import "server-only";
// Players → Draft: Jack's uploaded pre-draft rankings, ESPN's draft, and how both look now
// (lib/nba/draft-review.ts). The hindsight draft takes a second or two of lineup math, so it's
// computed at most once a day (after a visit, or nightly) and kept in view_cache.

import { after } from "next/server";
import {
  fetchLeague,
  fetchSeasonPool,
  parseDraftOrder,
  parsePlayerPool,
  type DraftPick,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import { db, dbConfigured } from "@/lib/db";
import { espnConfig } from "@/lib/env";
import { readView, writeView } from "@/lib/view-cache";
import { absences } from "./availability";
import { LAST_SCORING_PERIOD, gameDate } from "./calendar";
import { loadPlayersById } from "./data";
import {
  draftAccuracy,
  hindsightDraft,
  matchRankings,
  parseRankingsCsv,
  type Hindsight,
  type RankingRow,
} from "./draft-review";
import { loadPlayerPool } from "./pool";
import { perGameProjection } from "./projection";
import { seasonBaselines } from "./season-baselines";
import { rawValue, valueContext } from "./trade";
import type { PoolPlayer } from "./trends";
import { MIN_GAMES_NOW, ratesOf } from "./vs-last-season";

const HINDSIGHT_KEY = "draft-hindsight";

/** Replace the stored rankings with an upload; the names that matched no ESPN player. */
export async function importRankings(csv: string) {
  const rows = parseRankingsCsv(csv);
  if (!rows.length) throw new Error("no rankings found in the file");
  const cfg = espnConfig();
  // Every player ESPN lists this season (rookies and unsigned players included).
  const players = parsePlayerPool(await fetchSeasonPool(cfg.season, 1000), cfg.season);
  const { matched, unmatched } = matchRankings(rows, players);
  await db().begin(async (sql) => {
    await sql`delete from draft_rankings`;
    if (matched.length)
      await sql`insert into draft_rankings ${sql(
        matched.map((r) => ({
          player_id: r.playerId,
          name: r.name,
          team: r.team,
          rank: r.rank,
          tier: r.tier,
          value: r.value,
          fppg: r.fppg,
        })),
      )}`;
  });
  return { rows: rows.length, matched: matched.length, unmatched: unmatched.map((r) => r.name) };
}

async function loadRankings(): Promise<{ byId: Map<number, RankingRow>; at: Date | null }> {
  if (!dbConfigured()) return { byId: new Map(), at: null };
  const rows = await db()<(RankingRow & { player_id: number; imported_at: Date })[]>`
    select player_id, name, team, rank, tier, value, fppg, imported_at from draft_rankings
  `;
  return {
    byId: new Map(rows.map((r) => [r.player_id, r])),
    at: rows[0]?.imported_at ?? null,
  };
}

// The draft doesn't change: keep it for the life of the server instance.
let orderCache: DraftPick[] | null = null;
async function draftOrder(): Promise<DraftPick[]> {
  if (process.env.ESPN_LEAGUE_FILE) return [];
  orderCache ??= parseDraftOrder(await fetchLeague(espnConfig(), ["mDraftDetail"]));
  return orderCache;
}

export interface DraftRow {
  entry: PoolPlayer;
  ours: RankingRow | null;
  pick: DraftPick | null;
  /** The fantasy team that drafted him. */
  pickedBy: string | null;
  /** This season: FP/G and games. */
  actual: number | null;
  games: number;
  /** Today's projection, FP/G. */
  now: number;
  /** Rank by FP/G this season (players with 5+ games). */
  fppgRank: number | null;
  /** Rank by rest-of-season value if the league redrafted today. */
  redraftRank: number;
}

/** Everything the Draft tab shows (the hindsight draft from its cache; queued when stale). */
export async function loadDraftReview(now = new Date()) {
  const [{ sp, data, pool }, order, rankings] = await Promise.all([
    loadPlayerPool(now),
    draftOrder(),
    loadRankings(),
  ]);
  const current = espnConfig().season;
  const entries = new Map(pool.map((e) => [e.player.id, e]));
  // Drafted players since dropped deep enough to be neither rostered nor a top free agent.
  const missing = [...new Set([...order.map((p) => p.playerId), ...rankings.byId.keys()])].filter(
    (id) => !entries.has(id),
  );
  for (const p of (await loadPlayersById(missing, sp).catch(() => new Map())).values())
    entries.set(p.id, { player: p, owner: "Free agent", mine: false, available: true });

  const ctx = valueContext(
    data.games,
    data.settings.slotCounts,
    sp,
    LAST_SCORING_PERIOD,
    data.settings.regularSeasonWeeks,
    absences(
      [...entries.values()].map((e) => e.player),
      data.injuries,
      sp,
    ),
  );
  const teamName = new Map(data.teams.map((t) => [t.id, t.name]));
  const pickOf = new Map(order.map((p) => [p.playerId, p]));
  const all = [...entries.values()];
  const gamesOf = (p: RosterPlayer) => p.season?.stats.GP ?? 0;
  const byFppg = all
    .filter((e) => gamesOf(e.player) >= MIN_GAMES_NOW && e.player.season?.avg != null)
    .sort((a, b) => b.player.season!.avg! - a.player.season!.avg!);
  const fppgRank = new Map(byFppg.map((e, i) => [e.player.id, i + 1]));
  const ros = new Map(all.map((e) => [e.player.id, rawValue([e.player], ctx)]));
  const redraft = new Map(
    [...all]
      .sort((a, b) => ros.get(b.player.id)! - ros.get(a.player.id)!)
      .map((e, i) => [e.player.id, i + 1]),
  );
  const rows: DraftRow[] = [...new Set([...pickOf.keys(), ...rankings.byId.keys()])]
    .flatMap((id) => entries.get(id) ?? [])
    .map((entry) => {
      const id = entry.player.id;
      const pick = pickOf.get(id) ?? null;
      return {
        entry,
        ours: rankings.byId.get(id) ?? null,
        pick,
        pickedBy: pick ? (teamName.get(pick.teamId) ?? null) : null,
        actual: entry.player.season?.avg ?? null,
        games: gamesOf(entry.player),
        now: perGameProjection(entry.player).fppg,
        fppgRank: fppgRank.get(id) ?? null,
        redraftRank: redraft.get(id)!,
      };
    });

  // Our preseason projection vs what happened; the simple baseline is last season's FP/G.
  const [last] = await seasonBaselines(current).catch(() => []);
  const scoring = data.settings.scoring;
  const accuracy = draftAccuracy(
    rows
      .filter((r) => r.ours)
      .map((r) => {
        const prior = last?.lines.get(r.entry.player.id);
        return {
          playerId: r.entry.player.id,
          name: r.entry.player.name,
          pre: r.ours!.fppg,
          actual: r.actual,
          games: r.games,
          lastSeason: prior && prior.gp >= 20 ? ratesOf(prior, last!.season, scoring).fppg : null,
        };
      }),
  );

  // The hindsight draft: today's, or the last one while today's is computed.
  const today = gameDate(now);
  const cached = dbConfigured() ? await readView<Hindsight>(HINDSIGHT_KEY).catch(() => null) : null;
  if (order.length && dbConfigured() && cached?.fingerprint !== today)
    after(() => computeHindsight(today, order, entries, ctx, data.me.id).catch(() => {}));

  return {
    rows,
    rankingsAt: rankings.at,
    accuracy,
    hindsight: cached?.value ?? null,
    hindsightFresh: cached?.fingerprint === today,
    players: entries,
    me: data.me.id,
    order,
  };
}

let computing: Promise<void> | null = null;

async function computeHindsight(
  today: string,
  order: DraftPick[],
  entries: Map<number, PoolPlayer>,
  ctx: ReturnType<typeof valueContext>,
  teamId: number,
) {
  computing ??= (async () => {
    const t0 = performance.now();
    const players = new Map([...entries].map(([id, e]) => [id, e.player]));
    const soFar = (p: RosterPlayer) => p.season?.total ?? 0;
    const result = hindsightDraft(
      order,
      teamId,
      players,
      ctx,
      soFar,
      (p) => soFar(p) + rawValue([p], ctx),
    );
    if (result) await writeView(HINDSIGHT_KEY, today, result, performance.now() - t0);
  })().finally(() => {
    computing = null;
  });
  return computing;
}
