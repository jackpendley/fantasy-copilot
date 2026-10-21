// Turn raw ESPN league JSON into the shapes the app uses. Defensive: ESPN omits fields
// freely, so everything optional stays optional and unknown ids are dropped.

import { POSITIONAL_SLOT_IDS, PRO_TEAM_BY_ID, SLOT_BY_ID, STAT_BY_ID, statKey } from "./constants";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface LeagueSettings {
  name: string;
  /** Stat abbreviation -> points. */
  scoring: Record<string, number>;
  /** Slot name -> count, e.g. { PG: 1, UTIL: 2, BE: 3, IR: 1 }. */
  slotCounts: Record<string, number>;
  benchUnlimited: boolean;
  lineupLock: string | null;
  /**
   * When roster moves (adds, drops, IL) stop counting for today: "FIRSTGAME_SCORINGPERIOD" means
   * once the day's first game tips, moves take effect the next day.
   */
  rosterLock: string | null;
  regularSeasonWeeks: number;
  playoffTeams: number;
  /** Adds allowed per 7 days (ESPN stores a per-day rate when the limit is per scoring period). */
  addsPerWeek: number | null;
}

export function parseSettings(data: Json): LeagueSettings {
  const s = data?.settings ?? {};
  const slotCounts: Record<string, number> = {};
  for (const [id, n] of Object.entries(s.rosterSettings?.lineupSlotCounts ?? {})) {
    const name = SLOT_BY_ID[Number(id)];
    if (name && Number(n) > 0) slotCounts[name] = Number(n);
  }
  const scoring: Record<string, number> = {};
  for (const item of s.scoringSettings?.scoringItems ?? []) {
    const stat = STAT_BY_ID[item.statId];
    if (stat) scoring[stat] = item.points;
  }
  const acq = s.acquisitionSettings ?? {};
  const limit = Number(acq.matchupAcquisitionLimit);
  return {
    name: s.name ?? "",
    scoring,
    slotCounts,
    benchUnlimited: Boolean(s.rosterSettings?.isBenchUnlimited),
    lineupLock: s.rosterSettings?.lineupLocktimeType ?? null,
    rosterLock: s.rosterSettings?.rosterLocktimeType ?? null,
    regularSeasonWeeks: s.scheduleSettings?.matchupPeriodCount ?? 0,
    playoffTeams: s.scheduleSettings?.playoffTeamCount ?? 0,
    addsPerWeek:
      limit > 0 ? Math.round(acq.matchupLimitPerScoringPeriod ? limit * 7 : limit) : null,
  };
}

export interface StatWindow {
  /** Fantasy points per game under this league's scoring (ESPN's applied average). */
  avg: number | null;
  total: number | null;
  /** Raw per-game averages by stat abbreviation. */
  stats: Record<string, number>;
}

export interface RosterPlayer {
  id: number;
  name: string;
  proTeamId: number;
  proTeam: string;
  /** Real positions (PG..C). */
  positions: string[];
  /** Current lineup slot name, e.g. "UTIL", "BE", "IR". */
  slot: string | null;
  /** ESPN's injury status (ACTIVE, DAY_TO_DAY, OUT, ...). */
  injuryStatus: string | null;
  /** He's set to move into the IR slot when the next day starts (a move made after the roster lock). */
  pendingIR?: boolean;
  percentOwned: number | null;
  /** Change in league-wide ownership over the last week (percentage points). */
  percentChange: number | null;
  projection: StatWindow | null;
  season: StatWindow | null;
  last7: StatWindow | null;
  last15: StatWindow | null;
  last30: StatWindow | null;
  /** This season's single games ESPN sent with him ("05" + gameId entries), oldest first. */
  games?: GameEntry[];
  /** How the wider ESPN market values him: what other managers see and draft by. */
  market?: MarketSignals;
  /** ESPN won't let him be traded right now. */
  tradeLocked?: boolean;
}

export interface MarketSignals {
  /** ESPN average draft position across all leagues. */
  adp: number | null;
  /** Average auction price across ESPN auction drafts ($200 budgets). */
  auctionAvg: number | null;
  /** ESPN's own preseason rank and dollar value (standard points). */
  espnRank: number | null;
  espnAuction: number | null;
  /** ESPN's in-season overall rank (0 / null until it has games to rank). */
  seasonRank: number | null;
}

const positive = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);

function marketSignals(player: Json, poolEntry: Json): MarketSignals {
  const std = player?.draftRanksByRankType?.STANDARD;
  return {
    adp: positive(player?.ownership?.averageDraftPosition),
    auctionAvg: positive(player?.ownership?.auctionValueAverage),
    espnRank: positive(std?.rank),
    espnAuction: positive(std?.auctionValue),
    seasonRank: positive(poolEntry?.ratings?.["0"]?.totalRanking),
  };
}

export interface GameEntry {
  gameId: number;
  scoringPeriodId: number;
  /** Fantasy points in this league's scoring. */
  points: number;
  /** Box score by stat abbreviation (PTS, REB, AST, FGM, FGA, MIN...). */
  line: Record<string, number>;
}

const rawStats = (obj: Record<string, unknown> | undefined): Record<string, number> => {
  const raw: Record<string, number> = {};
  for (const [id, v] of Object.entries(obj ?? {})) {
    const stat = STAT_BY_ID[Number(id)];
    if (stat) raw[stat] = Number(v);
  }
  return raw;
};

/** Single-game stat entries: actual (source 0), one scoring period (split 5), keyed "05"+gameId. */
function gameEntries(stats: Json[]): GameEntry[] {
  return stats
    .filter(
      (x: Json) =>
        x.statSourceId === 0 && x.statSplitTypeId === 5 && String(x.id ?? "").startsWith("05"),
    )
    .map((x: Json) => ({
      gameId: Number(String(x.id).slice(2)),
      scoringPeriodId: x.scoringPeriodId,
      points: Number(x.appliedTotal ?? 0),
      line: rawStats(x.stats),
    }))
    .sort((a: GameEntry, b: GameEntry) => a.scoringPeriodId - b.scoringPeriodId);
}

function window(stats: Json[], key: string): StatWindow | null {
  const s = stats.find((x: Json) => x.id === key);
  if (!s) return null;
  const raw = rawStats(s.averageStats ?? s.stats);
  const avg = typeof s.appliedAverage === "number" ? s.appliedAverage : null;
  const total = typeof s.appliedTotal === "number" ? s.appliedTotal : null;
  if (avg === null && total === null) return null;
  return { avg, total, stats: raw };
}

const ENTRY_STATUSES = ["NORMAL", "FUTURE_TO_IR"];

/** A player object as ESPN nests it (roster entry or free agent). */
export function parsePlayer(
  player: Json,
  season: number,
  slotId?: number | null,
  entryInjury?: string | null,
  /** The pool entry around the player (ratings, trade lock), when ESPN sends one. */
  poolEntry?: Json,
): RosterPlayer {
  const stats: Json[] = player?.stats ?? [];
  return {
    id: player.id,
    name: player.fullName,
    proTeamId: player.proTeamId ?? 0,
    proTeam: PRO_TEAM_BY_ID[player.proTeamId] ?? "?",
    positions: (player.eligibleSlots ?? [])
      .filter((id: number) => POSITIONAL_SLOT_IDS.includes(id))
      .map((id: number) => SLOT_BY_ID[id]),
    slot: slotId != null ? (SLOT_BY_ID[slotId] ?? null) : null,
    // The roster entry's own status is about the slot ("NORMAL", "FUTURE_TO_IR"), not his health.
    injuryStatus:
      player.injuryStatus ??
      (entryInjury && !ENTRY_STATUSES.includes(entryInjury) ? entryInjury : null),
    pendingIR: entryInjury === "FUTURE_TO_IR",
    percentOwned: player.ownership?.percentOwned ?? null,
    percentChange: player.ownership?.percentChange ?? null,
    projection: window(stats, statKey(1, 0, season)),
    season: window(stats, statKey(0, 0, season)),
    last7: window(stats, statKey(0, 1, season)),
    last15: window(stats, statKey(0, 2, season)),
    last30: window(stats, statKey(0, 3, season)),
    games: gameEntries(stats),
    market: marketSignals(player, poolEntry),
    tradeLocked: Boolean(poolEntry?.tradeLocked),
  };
}

export interface FantasyTeam {
  id: number;
  name: string;
  abbrev: string;
  ownerId: string | null;
  wins: number;
  losses: number;
  pointsFor: number;
  /** Season-to-date lineup moves and waiver adds (`transactionCounter`), when ESPN sends it. */
  activity: {
    lineupMoves: number;
    adds: number;
    /** Adds made in each matchup week (the weekly cap counts these). */
    addsByPeriod: Record<number, number>;
  } | null;
  roster: RosterPlayer[];
}

export function parseTeams(data: Json): FantasyTeam[] {
  const season = data?.seasonId;
  return (data?.teams ?? []).map((t: Json) => ({
    id: t.id,
    name: (t.name ?? t.abbrev ?? `Team ${t.id}`).trim(),
    abbrev: t.abbrev ?? "",
    ownerId: t.primaryOwner ?? null,
    wins: t.record?.overall?.wins ?? 0,
    losses: t.record?.overall?.losses ?? 0,
    pointsFor: t.record?.overall?.pointsFor ?? 0,
    activity: t.transactionCounter
      ? {
          lineupMoves: t.transactionCounter.moveToActive ?? 0,
          adds: t.transactionCounter.acquisitions ?? 0,
          addsByPeriod: Object.fromEntries(
            Object.entries(t.transactionCounter.matchupAcquisitionTotals ?? {}).map(([k, v]) => [
              Number(k),
              Number(v),
            ]),
          ),
        }
      : null,
    roster: (t.roster?.entries ?? []).map((e: Json) =>
      parsePlayer(
        e.playerPoolEntry?.player ?? {},
        season,
        e.lineupSlotId,
        e.injuryStatus,
        e.playerPoolEntry,
      ),
    ),
  }));
}

export interface Matchup {
  id: number;
  period: number;
  homeTeamId: number;
  /** null on a bye week. */
  awayTeamId: number | null;
  homePoints: number;
  awayPoints: number | null;
  /** Including games in progress (ESPN's totalPointsLive); falls back to the settled total. */
  homeLive: number;
  awayLive: number | null;
  /** Points per scoring period (day) of this matchup, as ESPN has them. */
  homeByPeriod: Record<number, number>;
  awayByPeriod: Record<number, number> | null;
  winner: string;
}

const byPeriod = (side: Json): Record<number, number> =>
  Object.fromEntries(
    Object.entries(side?.pointsByScoringPeriod ?? {}).map(([k, v]) => [Number(k), Number(v)]),
  );

export function parseMatchups(data: Json): Matchup[] {
  return (data?.schedule ?? [])
    .filter((m: Json) => m.home)
    .map((m: Json) => ({
      id: m.id,
      period: m.matchupPeriodId,
      homeTeamId: m.home.teamId,
      awayTeamId: m.away?.teamId ?? null,
      homePoints: m.home.totalPoints ?? 0,
      awayPoints: m.away ? (m.away.totalPoints ?? 0) : null,
      homeLive: m.home.totalPointsLive ?? m.home.totalPoints ?? 0,
      awayLive: m.away ? (m.away.totalPointsLive ?? m.away.totalPoints ?? 0) : null,
      homeByPeriod: byPeriod(m.home),
      awayByPeriod: m.away ? byPeriod(m.away) : null,
      winner: m.winner ?? "UNDECIDED",
    }));
}

export interface ProGame {
  gameId: number;
  scoringPeriodId: number;
  /** Tip-off, epoch ms. */
  date: number;
  homeProTeamId: number;
  awayProTeamId: number;
}

/** proTeamSchedules_wl -> every NBA game once, ordered by tip time. */
export function parseProSchedule(data: Json): ProGame[] {
  const games = new Map<number, ProGame>();
  for (const team of data?.settings?.proTeams ?? []) {
    for (const [sp, list] of Object.entries(team.proGamesByScoringPeriod ?? {})) {
      for (const g of list as Json[]) {
        games.set(g.id, {
          gameId: g.id,
          scoringPeriodId: Number(sp),
          date: g.date,
          homeProTeamId: g.homeProTeamId,
          awayProTeamId: g.awayProTeamId,
        });
      }
    }
  }
  return [...games.values()].sort((a, b) => a.date - b.date);
}

/** Players from a `kona_player_info` query (e.g. the free-agent pool). */
export function parsePlayerPool(data: Json, season: number): RosterPlayer[] {
  return (data?.players ?? [])
    .map((e: Json) => e.player ?? e.playerPoolEntry?.player)
    .filter(Boolean)
    .map((p: Json) => parsePlayer(p, season));
}

export interface FreeAgent {
  player: RosterPlayer;
  /** FREEAGENT: add now. WAIVERS: claim; it processes at `waiverUntil`. */
  status: "FREEAGENT" | "WAIVERS";
  waiverUntil: number | null;
}

/** Free agents and waiver players from a `kona_player_info` query with `freeAgentFilter`. */
export function parseFreeAgents(data: Json, season: number): FreeAgent[] {
  return (data?.players ?? [])
    .filter((e: Json) => e.player && (e.status === "FREEAGENT" || e.status === "WAIVERS"))
    .map((e: Json) => ({
      player: parsePlayer(e.player, season, null, null, e),
      status: e.status,
      waiverUntil: e.status === "WAIVERS" ? (e.waiverProcessDate ?? null) : null,
    }));
}

export interface LiveEntry {
  playerId: number;
  /** Lineup slot today (BE/IR don't count). */
  slot: string;
  /** Fantasy points so far today. */
  points: number;
  /** Today's box score (PTS, REB, AST, FGM, FGA, MIN...), once his game has started. */
  line: Record<string, number> | null;
}

/**
 * Today's per-player fantasy points for each team in a matchup period, from the `mBoxscore`
 * view (`rosterForCurrentScoringPeriod`). Keyed by fantasy team id.
 */
export function parseLiveRosters(data: Json, matchupPeriod: number): Map<number, LiveEntry[]> {
  const out = new Map<number, LiveEntry[]>();
  for (const m of data?.schedule ?? []) {
    if (m.matchupPeriodId !== matchupPeriod) continue;
    for (const side of [m.home, m.away]) {
      const roster = side?.rosterForCurrentScoringPeriod;
      if (!side || !roster) continue;
      out.set(
        side.teamId,
        (roster.entries ?? []).map((e: Json) => ({
          playerId: e.playerId ?? e.playerPoolEntry?.id ?? e.playerPoolEntry?.player?.id,
          slot: SLOT_BY_ID[e.lineupSlotId] ?? String(e.lineupSlotId),
          points: Number(e.playerPoolEntry?.appliedStatTotal ?? 0),
          line: gameEntries(e.playerPoolEntry?.player?.stats ?? []).at(-1)?.line ?? null,
        })),
      );
    }
  }
  return out;
}

/** Overall pick number for each drafted player, from the `mDraftDetail` view. */
export function parseDraftPicks(data: Json): Map<number, number> {
  const picks = new Map<number, number>();
  for (const p of data?.draftDetail?.picks ?? []) {
    if (p.playerId && p.overallPickNumber && !p.keeper) picks.set(p.playerId, p.overallPickNumber);
  }
  return picks;
}

export interface LeagueTransaction {
  type: "WAIVER" | "FREEAGENT" | "TRADE";
  teamId: number;
  /** When ESPN processed it, or when it was made if ESPN hasn't stamped it yet (ms since epoch). */
  at: number;
  /** Players added to and dropped from `teamId`'s roster (for a trade: received and sent). */
  adds: number[];
  drops: number[];
}

/**
 * Executed roster changes from the `mTransactions2` view: waiver claims, free-agent adds and
 * accepted trades. Lineup moves are skipped. A trade becomes one entry per team involved.
 */
export function parseTransactions(data: Json): LeagueTransaction[] {
  const out: LeagueTransaction[] = [];
  for (const t of data?.transactions ?? []) {
    // A free-agent add made after the roster lock is executed but has no processDate until it
    // takes effect the next day; it counts from when it was made.
    const at = t.processDate ?? t.proposedDate;
    if (t.status !== "EXECUTED" || !at) continue;
    const items: Json[] = t.items ?? [];
    if (t.type === "WAIVER" || t.type === "FREEAGENT") {
      out.push({
        type: t.type,
        teamId: t.teamId,
        at,
        adds: items.filter((i) => i.type === "ADD").map((i) => i.playerId),
        drops: items.filter((i) => i.type === "DROP").map((i) => i.playerId),
      });
    } else if (t.type === "TRADE_ACCEPT") {
      const teams = new Set<number>(items.flatMap((i) => [i.fromTeamId, i.toTeamId]));
      for (const team of teams) {
        if (!team) continue;
        out.push({
          type: "TRADE",
          teamId: team,
          at,
          adds: items.filter((i) => i.toTeamId === team).map((i) => i.playerId),
          drops: items.filter((i) => i.fromTeamId === team).map((i) => i.playerId),
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
