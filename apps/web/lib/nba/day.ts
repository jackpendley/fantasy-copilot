// One day's lineup board: who plays, who is hurt, who is locked, and the best lineup.
// Pure: every input is passed in, so it is tested without the network.

import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { PRO_TEAM_BY_ID } from "@fantasy-copilot/espn";
import {
  currentPoints,
  irEligible,
  isStartingSlot,
  optimizeLineup,
  playProbability,
  slotAccepts,
  type Move,
  type Position,
} from "@fantasy-copilot/fantasy-core";
import {
  buildMatcher,
  toEspnTeam,
  type InjuryReport,
  type LineupEntry,
  type ScoreboardGame,
} from "@fantasy-copilot/nba-data";
import { gameEnvironment, perGameProjection, type PerGame } from "./projection";

export interface DayGame {
  gameId: number;
  opponent: string;
  home: boolean;
  tip: string;
  state: "pre" | "in" | "post";
  detail: string;
}

export interface DayRow {
  player: RosterPlayer;
  game: DayGame | null;
  /** His game has started: ESPN won't let him move. */
  locked: boolean;
  status: string;
  injuryNote: string | null;
  playProb: number;
  projection: PerGame;
  /** Expected points if started: playProb x fppg (0 without a game). */
  value: number;
  currentSlot: string;
  recommendedSlot: string;
  /** NBA.com daily lineups, when published for this date and matched to him. */
  nba: { starter: boolean; confirmed: boolean; inactive: boolean } | null;
}

export interface DayBoard {
  rows: DayRow[];
  currentPoints: number;
  optimalPoints: number;
  moves: (Move & { name: string })[];
  /** Starters in the current lineup who have no game today. */
  idleStarters: string[];
  /** Recommended starters who may sit, and the bench player to swap in if they do. */
  hedges: Hedge[];
}

/**
 * Individual-game lock means a questionable starter can still be benched until his tip,
 * as long as a bench player whose game tips later can take the slot.
 */
export interface Hedge {
  playerId: number;
  name: string;
  status: string;
  slot: string;
  tip: string;
  backup: { playerId: number; name: string; tip: string; value: number } | null;
}

export interface DayInputs {
  roster: RosterPlayer[];
  slotCounts: Record<string, number>;
  /** NBA games in this scoring period (ESPN schedule). */
  games: ProGame[];
  /** Live state and tip times for the same date, when available. */
  scoreboard: ScoreboardGame[];
  injuries: InjuryReport[];
  /** NBA.com daily lineups for this date (null/absent before NBA.com publishes). */
  lineups?: LineupEntry[] | null;
  now?: Date;
}

/** ESPN's site injury feed is more granular ("Questionable") than the fantasy status. */
function statusOf(p: RosterPlayer, injuries: Map<number, InjuryReport>) {
  const site = injuries.get(p.id);
  return {
    status: site?.status || p.injuryStatus || "ACTIVE",
    note: site?.short || null,
  };
}

export function buildDayBoard(input: DayInputs): DayBoard {
  const now = input.now ?? new Date();
  const injuries = new Map(input.injuries.map((i) => [i.playerId, i]));
  const live = new Map(input.scoreboard.map((g) => [g.gameId, g]));
  const gameOf = (proTeamId: number): DayGame | null => {
    const g = input.games.find(
      (x) => x.homeProTeamId === proTeamId || x.awayProTeamId === proTeamId,
    );
    if (!g) return null;
    const home = g.homeProTeamId === proTeamId;
    const s = live.get(g.gameId);
    const tip = s?.tip ?? new Date(g.date).toISOString();
    const started = s ? s.state !== "pre" : Date.parse(tip) <= now.getTime();
    return {
      gameId: g.gameId,
      opponent: PRO_TEAM_BY_ID[home ? g.awayProTeamId : g.homeProTeamId] ?? "?",
      home,
      tip,
      state: s?.state ?? (started ? "in" : "pre"),
      detail: s?.detail ?? "",
    };
  };

  const match = buildMatcher(
    input.roster.map((p) => ({ id: p.id, name: p.name, team: p.proTeam })),
  );
  const nbaById = new Map<number, LineupEntry>();
  for (const e of input.lineups ?? []) {
    const id = match(e.name, toEspnTeam(e.team));
    if (id != null) nbaById.set(id, e);
  }

  const rows: DayRow[] = input.roster.map((player) => {
    const game = gameOf(player.proTeamId);
    const entry = nbaById.get(player.id);
    const nba = entry
      ? {
          starter: entry.starter,
          confirmed: entry.lineupStatus === "Confirmed",
          inactive: entry.rosterStatus === "Inactive",
        }
      : null;
    const injury = statusOf(player, injuries);
    // NBA.com's inactive list is the final word once a team files it.
    const status = nba?.inactive ? "OUT" : injury.status;
    const note = nba?.inactive
      ? `Inactive (NBA.com)${injury.note ? ` · ${injury.note}` : ""}`
      : injury.note;
    const playProb = game ? playProbability(status) : 0;
    const projection = perGameProjection(player, input.games[0]?.scoringPeriodId);
    // Vegas game environment: more expected team points, more fantasy points to go around.
    const env = game ? gameEnvironment(live.get(game.gameId), game.home) : 1;
    return {
      player,
      game,
      locked: Boolean(game && game.state !== "pre"),
      status,
      injuryNote: note,
      playProb,
      projection,
      value: game ? playProb * projection.fppg * env : 0,
      currentSlot: player.slot ?? "BE",
      recommendedSlot: player.slot ?? "BE",
      nba,
    };
  });

  const lineupPlayers = rows.map((r) => ({
    id: r.player.id,
    eligible: r.player.positions as Position[],
    value: r.value,
    currentSlot: r.currentSlot,
    locked: r.locked,
    irEligible: irEligible(r.status),
  }));
  const best = optimizeLineup(lineupPlayers, input.slotCounts);
  for (const r of rows) r.recommendedSlot = best.slotOf.get(r.player.id) ?? r.currentSlot;
  const name = new Map(rows.map((r) => [r.player.id, r.player.name]));

  const hedges: Hedge[] = rows
    .filter(
      (r) =>
        isStartingSlot(r.recommendedSlot) &&
        r.game?.state === "pre" &&
        r.playProb > 0 &&
        r.playProb < 1,
    )
    .map((r) => {
      const backup = rows
        .filter(
          (b) =>
            b.recommendedSlot === "BE" &&
            b.game?.state === "pre" &&
            b.playProb > 0 &&
            Date.parse(b.game.tip) > Date.parse(r.game!.tip) &&
            slotAccepts(r.recommendedSlot, b.player.positions as Position[]),
        )
        .sort((a, b) => b.value - a.value)[0];
      return {
        playerId: r.player.id,
        name: r.player.name,
        status: r.status,
        slot: r.recommendedSlot,
        tip: r.game!.tip,
        backup: backup
          ? {
              playerId: backup.player.id,
              name: backup.player.name,
              tip: backup.game!.tip,
              value: backup.value,
            }
          : null,
      };
    });

  return {
    rows,
    hedges,
    currentPoints: currentPoints(lineupPlayers),
    optimalPoints: best.points,
    moves: best.moves.map((m) => ({ ...m, name: name.get(m.playerId) ?? String(m.playerId) })),
    idleStarters: rows
      .filter((r) => isStartingSlot(r.currentSlot) && !r.game)
      .map((r) => r.player.name),
  };
}
