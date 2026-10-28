// Head-to-head by lineup slot, ESPN-app style: one row per starting slot with each team's
// player in it, for any day of the matchup week. Past days show final points, today is live,
// days ahead show the projected lineups. Pure: the Matchup page passes in the data.

import {
  PRO_TEAM_BY_ID,
  type LiveEntry,
  type ProGame,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import { expandSlots, isStartingSlot } from "@fantasy-copilot/fantasy-core";
import { slotRank } from "@/lib/format";
import { trendOf, type LiveRow, type Trend } from "./live";

export interface H2HGame {
  opponent: string;
  home: boolean;
  state: "pre" | "in" | "post";
  /** Tip-off, ISO. */
  tip: string;
  /** ESPN's status text while live ("Q3 5:12"). */
  detail: string;
  score: { us: number; them: number } | null;
}

export interface H2HCell {
  player: Pick<RosterPlayer, "id" | "name" | "proTeam" | "positions">;
  status: string;
  /** "back ~Nov 9" for a ruled-out player. */
  back?: string | null;
  game: H2HGame | null;
  /** Fantasy points scored; null before his game starts. */
  points: number | null;
  /**
   * The projection under (or instead of) the points: pregame before tip and after the final,
   * points so far plus the unplayed share while live. Null with no game.
   */
  proj: number | null;
  trend: Trend;
  line: Record<string, number> | null;
}

export interface Placed {
  slot: string;
  cell: H2HCell;
}

export interface H2HRow {
  slot: string;
  mine: H2HCell | null;
  theirs: H2HCell | null;
}

/** The league's starting slots in ESPN's display order (PG, SG, SF, PF, C, G, F, UTIL...). */
export function startingSlots(slotCounts: Record<string, number>): string[] {
  return expandSlots(slotCounts)
    .filter(isStartingSlot)
    .sort((a, b) => slotRank(a) - slotRank(b));
}

/** Rows by slot for both teams, plus each side's bench and IR (best first). */
export function pairBySlot(slots: string[], mine: Placed[], theirs: Placed[]) {
  const fill = (placed: Placed[]) => {
    const pool = [...placed];
    return slots.map((slot) => {
      const i = pool.findIndex((p) => p.slot === slot);
      return i < 0 ? null : pool.splice(i, 1)[0]!.cell;
    });
  };
  const m = fill(mine);
  const t = fill(theirs);
  const value = (c: H2HCell) => c.points ?? c.proj ?? -1;
  const rest = (placed: Placed[], slot: string) =>
    placed
      .filter((p) => p.slot === slot)
      .map((p) => p.cell)
      .sort((a, b) => value(b) - value(a));
  return {
    rows: slots.map((slot, i): H2HRow => ({ slot, mine: m[i] ?? null, theirs: t[i] ?? null })),
    bench: { mine: rest(mine, "BE"), theirs: rest(theirs, "BE") },
    ir: { mine: rest(mine, "IR"), theirs: rest(theirs, "IR") },
  };
}

/** Today: a live row as a cell. */
export function cellFromLive(r: LiveRow): Placed {
  const g = r.row.game;
  const started = Boolean(g && g.state !== "pre");
  return {
    slot: r.slot,
    cell: {
      player: r.row.player,
      status: r.row.status,
      back: r.row.back,
      game: g
        ? {
            opponent: g.opponent,
            home: g.home,
            state: g.state,
            tip: g.tip,
            detail: g.detail,
            score: r.score,
          }
        : null,
      points: started ? r.points : null,
      proj: !g ? null : g.state === "in" ? r.projected : r.pregame,
      trend: r.trend,
      line: started ? r.line : null,
    },
  };
}

/** A pro team's game on a given day of the schedule (state from the clock, no live data). */
export function gameOn(
  games: ProGame[],
  proTeamId: number,
  sp: number,
  state: H2HGame["state"],
): H2HGame | null {
  const g = games.find(
    (x) =>
      x.scoringPeriodId === sp && (x.homeProTeamId === proTeamId || x.awayProTeamId === proTeamId),
  );
  if (!g) return null;
  const home = g.homeProTeamId === proTeamId;
  return {
    opponent: PRO_TEAM_BY_ID[home ? g.awayProTeamId : g.homeProTeamId] ?? "?",
    home,
    state,
    tip: new Date(g.date).toISOString(),
    detail: state === "post" ? "Final" : "",
    score: null,
  };
}

/** A past day: ESPN's final fantasy points, against the pregame projection for that day. */
export function cellFromFinal(
  e: LiveEntry,
  player: H2HCell["player"] | undefined,
  game: H2HGame | null,
  pregame: number,
): Placed {
  return {
    slot: e.slot,
    cell: {
      player: player ?? {
        id: e.playerId,
        name: `Player ${e.playerId}`,
        proTeam: "",
        positions: [],
      },
      status: "ACTIVE",
      game,
      points: game ? e.points : null,
      proj: game ? pregame : null,
      trend: game ? trendOf(pregame, e.points) : null,
      line: game ? e.line : null,
    },
  };
}

/** A day ahead: the projected lineup (starters in their slots, others with a game on the bench). */
export function cellsAhead(
  roster: RosterPlayer[],
  slotOf: Map<number, string> | undefined,
  games: ProGame[],
  sp: number,
  projOf: (p: RosterPlayer) => number,
  statusOf: (p: RosterPlayer) => string,
  backOf: (p: RosterPlayer) => string | null = () => null,
): Placed[] {
  return roster.map((p) => {
    const game = gameOn(games, p.proTeamId, sp, "pre");
    return {
      slot: slotOf?.get(p.id) ?? (p.slot === "IR" ? "IR" : "BE"),
      cell: {
        player: p,
        status: statusOf(p),
        back: backOf(p),
        game,
        points: null,
        // Out that day (or no projection): nothing to show.
        proj: game && projOf(p) > 0 ? projOf(p) : null,
        trend: null,
        line: null,
      },
    };
  });
}

/** Points that count for a side on a day: starters' points (live) or projections (ahead). */
export function dayTotal(rows: H2HRow[], side: "mine" | "theirs", ahead: boolean): number {
  return rows.reduce((a, r) => {
    const c = r[side];
    if (!c) return a;
    return a + (ahead ? (c.proj ?? 0) : (c.points ?? 0));
  }, 0);
}
