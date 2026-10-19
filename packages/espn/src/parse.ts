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
  injuryStatus: string | null;
  percentOwned: number | null;
  projection: StatWindow | null;
  season: StatWindow | null;
  last7: StatWindow | null;
  last15: StatWindow | null;
  last30: StatWindow | null;
}

function window(stats: Json[], key: string): StatWindow | null {
  const s = stats.find((x: Json) => x.id === key);
  if (!s) return null;
  const raw: Record<string, number> = {};
  for (const [id, v] of Object.entries(s.averageStats ?? s.stats ?? {})) {
    const stat = STAT_BY_ID[Number(id)];
    if (stat) raw[stat] = Number(v);
  }
  const avg = typeof s.appliedAverage === "number" ? s.appliedAverage : null;
  const total = typeof s.appliedTotal === "number" ? s.appliedTotal : null;
  if (avg === null && total === null) return null;
  return { avg, total, stats: raw };
}

/** A player object as ESPN nests it (roster entry or free agent). */
export function parsePlayer(
  player: Json,
  season: number,
  slotId?: number | null,
  entryInjury?: string | null,
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
    injuryStatus: entryInjury ?? player.injuryStatus ?? null,
    percentOwned: player.ownership?.percentOwned ?? null,
    projection: window(stats, statKey(1, 0, season)),
    season: window(stats, statKey(0, 0, season)),
    last7: window(stats, statKey(0, 1, season)),
    last15: window(stats, statKey(0, 2, season)),
    last30: window(stats, statKey(0, 3, season)),
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
  activity: { lineupMoves: number; adds: number } | null;
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
        }
      : null,
    roster: (t.roster?.entries ?? []).map((e: Json) =>
      parsePlayer(e.playerPoolEntry?.player ?? {}, season, e.lineupSlotId, e.injuryStatus),
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
  winner: string;
}

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
