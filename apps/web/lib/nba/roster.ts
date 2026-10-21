// Today's roster and tomorrow's. In this league a roster move (add, drop, IL) made after the
// day's first game tips takes effect the next day, so ESPN keeps two rosters: today's (who
// scores today) and tomorrow's (who scores from then on). Forward-looking numbers use both.

import type { LeagueSettings, RosterPlayer } from "@fantasy-copilot/espn";
import type { ScoreboardGame } from "@fantasy-copilot/nba-data";

export interface PendingMoves {
  adds: RosterPlayer[];
  drops: RosterPlayer[];
  /** Moving into the IR slot tomorrow, or out of it. */
  toIR: RosterPlayer[];
  fromIR: RosterPlayer[];
}

/** Roster changes that take effect tomorrow (empty when today's and tomorrow's rosters match). */
export function pendingMoves(today: RosterPlayer[], ahead: RosterPlayer[]): PendingMoves {
  const todayById = new Map(today.map((p) => [p.id, p]));
  const aheadIds = new Set(ahead.map((p) => p.id));
  return {
    adds: ahead.filter((p) => !todayById.has(p.id)),
    drops: today.filter((p) => !aheadIds.has(p.id)),
    toIR: ahead.filter(
      (p) => p.slot === "IR" && todayById.has(p.id) && todayById.get(p.id)!.slot !== "IR",
    ),
    fromIR: ahead.filter((p) => p.slot !== "IR" && todayById.get(p.id)?.slot === "IR"),
  };
}

export const hasPendingMoves = (m: PendingMoves) =>
  m.adds.length + m.drops.length + m.toIR.length + m.fromIR.length > 0;

/**
 * Everyone who can score for a team this week from day `sp`: tomorrow's roster (with its slots),
 * plus players dropped tomorrow, who still count today. `availableFrom`/`availableUntil` bound
 * the days each player can be used.
 */
export function weekRoster(today: RosterPlayer[], ahead: RosterPlayer[], sp: number) {
  const moves = pendingMoves(today, ahead);
  return {
    roster: [...ahead, ...moves.drops],
    availableFrom: new Map(moves.adds.map((p) => [p.id, sp + 1])),
    availableUntil: new Map(moves.drops.map((p) => [p.id, sp])),
  };
}

/**
 * Has today's roster locked? With ESPN's "first game of the scoring period" rule, once any game
 * today has tipped, adds and drops count from tomorrow.
 */
export function rosterLocked(
  settings: Pick<LeagueSettings, "rosterLock">,
  todayTips: number[],
  scoreboard: Pick<ScoreboardGame, "state">[],
  now: Date = new Date(),
): boolean {
  if (settings.rosterLock !== "FIRSTGAME_SCORINGPERIOD") return false;
  return dayStarted(todayTips, scoreboard, now);
}

/** Has any of today's games tipped? */
export function dayStarted(
  todayTips: number[],
  scoreboard: Pick<ScoreboardGame, "state">[],
  now: Date = new Date(),
): boolean {
  return scoreboard.some((g) => g.state !== "pre") || todayTips.some((tip) => tip <= now.getTime());
}
