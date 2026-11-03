import "server-only";
// Roster move history (ADR-056): every league move stored in league_transactions, and for a
// team, what each move did: its odds change at the time (the Outlook runs around it), the
// fantasy points the players in and out have scored since, and their value now. Plus the games
// its players have missed while on the roster.

import { fetchLeague, parseTransactions, type RosterPlayer } from "@fantasy-copilot/espn";
import { fetchGameLog } from "@fantasy-copilot/nba-data";
import type { ScoringMap } from "@fantasy-copilot/fantasy-core";
import { db, dbConfigured } from "@/lib/db";
import { espnConfig } from "@/lib/env";
import { memoAsync, memoFetch } from "@/lib/fetch-memo";
import { loadPlayersById, nbaSchedule } from "./data";
import {
  gamesMissed,
  oddsAroundMove,
  pointsBetween,
  stintEnds,
  type AtTheTime,
  type RunOdds,
  type ScoredGame,
} from "./move-impact";
import type { OutlookTeam } from "./outlook-run";
import { scoreGames } from "./player";
import { perGameProjection } from "./projection";
import { rawValue, type valueContext } from "./trade";

const TX_FETCH = memoFetch(5 * 60_000);
const LOG_FETCH = memoFetch(30 * 60_000);

export interface StoredMove {
  teamId: number;
  type: "WAIVER" | "FREEAGENT" | "TRADE";
  at: number;
  adds: number[];
  drops: number[];
}

/**
 * Store moves from ESPN: every scoring period so far the first time, then the last two (moves
 * are listed by the period they're processed in). At most every 5 minutes per instance.
 */
export const syncTransactions = memoAsync(
  5 * 60_000,
  (sp: number) => String(sp),
  async (sp: number) => {
    if (!dbConfigured() || process.env.ESPN_LEAGUE_FILE) return 0;
    const [row] = await db()<{ n: number }[]>`select count(*)::int as n from league_transactions`;
    const from = row?.n ? Math.max(1, sp - 1) : 1;
    const cfg = espnConfig();
    let stored = 0;
    for (let p = from; p <= sp; p++) {
      const list = await fetchLeague(cfg, ["mTransactions2"], {
        scoringPeriodId: p,
        fetchImpl: TX_FETCH,
      }).then(parseTransactions);
      if (!list.length) continue;
      const rows = list.map((t) => ({
        key: `${t.teamId}:${t.at}:${t.adds.join(",")}:${t.drops.join(",")}`,
        team_id: t.teamId,
        type: t.type,
        at: new Date(t.at),
        scoring_period: p,
        adds: t.adds,
        drops: t.drops,
      }));
      const res =
        await db()`insert into league_transactions ${db()(rows)} on conflict (key) do nothing`;
      stored += res.count;
    }
    return stored;
  },
);

async function storedMoves(): Promise<StoredMove[]> {
  const rows = await db()<
    { team_id: number; type: StoredMove["type"]; at: Date; adds: number[]; drops: number[] }[]
  >`select team_id, type, at, adds, drops from league_transactions order by at`;
  return rows.map((r) => ({
    teamId: r.team_id,
    type: r.type,
    at: r.at.getTime(),
    adds: r.adds,
    drops: r.drops,
  }));
}

/** Every final Outlook run's odds, oldest first (5 minutes per instance). */
const outlookOdds = memoAsync(
  5 * 60_000,
  () => "all",
  async (): Promise<RunOdds[]> => {
    const rows = await db()<{ run_at: Date; results: OutlookTeam[] }[]>`
      select run_at, results from outlook_runs where status = 'final' order by run_at
    `;
    return rows.map((r) => ({
      runAt: r.run_at.getTime(),
      teams: new Map(
        r.results.map((t) => [
          t.teamId,
          { champ: t.champ, playoffs: t.playoffs, expWins: t.expWins },
        ]),
      ),
    }));
  },
);

/** His season so far, each game scored in this league and timed by the NBA schedule. */
const scoredLog = memoAsync<
  [id: number, season: number, scoring: ScoringMap, tips: Map<number, number>],
  (ScoredGame & { gameId: number })[]
>(
  30 * 60_000,
  (id, season) => `${id}:${season}`,
  async (id: number, season: number, scoring: ScoringMap, tips: Map<number, number>) => {
    const log = await fetchGameLog(id, season, LOG_FETCH).catch(() => []);
    return scoreGames(log, scoring)
      .filter((r) => r.part === "regular")
      .map((r): ScoredGame & { gameId: number } => ({
        gameId: r.gameId,
        tip: tips.get(r.gameId) ?? Date.parse(r.date),
        fp: r.fp,
        minutes: r.line.MIN ?? 0,
      }));
  },
);

export interface MovePlayer {
  id: number;
  name: string;
  /** Fantasy points since the move (an added player: while on this roster). */
  points: number;
  games: number;
  /** Projected points over his remaining games, today. */
  rosNow: number;
}

export interface MoveReport {
  type: StoredMove["type"];
  at: number;
  adds: MovePlayer[];
  drops: MovePlayer[];
  /** The team's odds just before and after (null without a run on both sides). */
  atTheTime: AtTheTime | null;
  /** Points the added players scored since, minus the dropped players'. */
  pointsNet: number;
  /** Rest-of-season value in minus out, today. */
  rosNet: number;
}

export interface InjuryImpact {
  id: number;
  name: string;
  status: string;
  /** Team games he's missed while on this roster this season. */
  missed: number;
  /** Those games times his projection: the points it has cost so far. */
  pointsLost: number;
}

interface View {
  sp: number;
  ctx: ReturnType<typeof valueContext>;
  data: {
    settings: { scoring: ScoringMap };
    teams: { id: number; roster: RosterPlayer[] }[];
  };
}

/** A team's roster moves this season, newest first, with their impact; and its injuries. */
export async function teamHistory(teamId: number, v: View, now = Date.now()) {
  if (!dbConfigured()) return null;
  await syncTransactions(v.sp).catch(() => 0);
  const cfg = espnConfig();
  const [all, runs, schedule] = await Promise.all([
    storedMoves(),
    outlookOdds(),
    nbaSchedule(cfg.season),
  ]);
  const tips = new Map(schedule.map((g) => [g.gameId, g.date]));
  const scoring = v.data.settings.scoring;
  const roster = v.data.teams.find((t) => t.id === teamId)?.roster ?? [];

  const ends = stintEnds(all);
  const mine = all.map((m, i) => ({ m, i })).filter(({ m }) => m.teamId === teamId);
  const ids = [...new Set(mine.flatMap(({ m }) => [...m.adds, ...m.drops]))];
  const onRoster = new Map(roster.map((p) => [p.id, p]));
  const elsewhere = await loadPlayersById(
    ids.filter((id) => !onRoster.has(id)),
    v.sp,
  ).catch(() => new Map<number, RosterPlayer>());
  const player = (id: number) => onRoster.get(id) ?? elsewhere.get(id);
  const logs = new Map(
    await Promise.all(
      [...new Set([...ids, ...roster.map((p) => p.id)])].map(
        async (id) => [id, await scoredLog(id, cfg.season, scoring, tips)] as const,
      ),
    ),
  );
  const movesAt = all.map((m) => m.at);

  const describe = (id: number, from: number, until: number): MovePlayer => {
    const p = player(id);
    const since = pointsBetween(logs.get(id) ?? [], from, until);
    return {
      id,
      name: p?.name ?? `Player ${id}`,
      points: since.points,
      games: since.games,
      rosNow: p ? rawValue([p], v.ctx) : 0,
    };
  };
  const moves: MoveReport[] = mine.map(({ m, i }) => {
    const adds = m.adds.map((id) => describe(id, m.at, ends.get(`${i}:${id}`) ?? Infinity));
    const drops = m.drops.map((id) => describe(id, m.at, Infinity));
    const sum = (xs: MovePlayer[], k: "points" | "rosNow") => xs.reduce((a, x) => a + x[k], 0);
    return {
      type: m.type,
      at: m.at,
      adds,
      drops,
      atTheTime: oddsAroundMove(runs, teamId, m.at, movesAt),
      pointsNet: sum(adds, "points") - sum(drops, "points"),
      rosNet: sum(adds, "rosNow") - sum(drops, "rosNow"),
    };
  });

  // Injuries: games each current player has missed since he joined (his last add here, or the
  // start of the season for a drafted player), valued at his projection.
  const injuries: InjuryImpact[] = roster
    .map((p) => {
      const joined = [...mine].reverse().find(({ m }) => m.adds.includes(p.id))?.m.at ?? 0;
      const teamGames = schedule
        .filter((g) => g.homeProTeamId === p.proTeamId || g.awayProTeamId === p.proTeamId)
        .map((g) => ({ gameId: g.gameId, tip: g.date }));
      const played = (logs.get(p.id) ?? []).filter((g) => g.minutes > 0).map((g) => g.gameId);
      const missed = gamesMissed(teamGames, played, joined, now - 3 * 3600_000);
      return {
        id: p.id,
        name: p.name,
        status: p.injuryStatus ?? "ACTIVE",
        missed,
        pointsLost: missed * perGameProjection(p).fppg,
      };
    })
    .filter((x) => x.missed > 0)
    .sort((a, b) => b.pointsLost - a.pointsLost);

  return { moves: moves.reverse(), injuries };
}

export interface ImpactfulMove {
  teamId: number;
  type: StoredMove["type"];
  at: number;
  adds: { id: number; name: string }[];
  drops: { id: number; name: string }[];
  atTheTime: AtTheTime;
}

/** The season's moves that changed their team's title odds most at the time (clean ones). */
export async function mostImpactfulMoves(sp: number, limit = 5): Promise<ImpactfulMove[]> {
  if (!dbConfigured()) return [];
  await syncTransactions(sp).catch(() => 0);
  const [all, runs] = await Promise.all([storedMoves(), outlookOdds()]);
  const movesAt = all.map((m) => m.at);
  const top = all
    .map((m) => ({ m, odds: oddsAroundMove(runs, m.teamId, m.at, movesAt) }))
    .filter((x): x is { m: StoredMove; odds: AtTheTime } => !!x.odds?.clean)
    .sort((a, b) => Math.abs(b.odds.champ) - Math.abs(a.odds.champ))
    .slice(0, limit);
  const ids = [...new Set(top.flatMap(({ m }) => [...m.adds, ...m.drops]))];
  const players = await loadPlayersById(ids, sp).catch(() => new Map<number, RosterPlayer>());
  const named = (id: number) => ({ id, name: players.get(id)?.name ?? `Player ${id}` });
  return top.map(({ m, odds }) => ({
    teamId: m.teamId,
    type: m.type,
    at: m.at,
    adds: m.adds.map(named),
    drops: m.drops.map(named),
    atTheTime: odds,
  }));
}
