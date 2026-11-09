// The Matchup scoreboard's details: each team's record and place, and its starts and points per
// start so far and projected for the rest of the week. Pure.

import type { FantasyTeam } from "@fantasy-copilot/espn";

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

/** "5-2" (or "5-2-1" with ties) and the place in the standings (wins, then points for). */
export function recordOf(team: FantasyTeam, teams: FantasyTeam[]): string {
  const place =
    [...teams]
      .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor)
      .findIndex((t) => t.id === team.id) + 1;
  const wl = `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}`;
  return place > 0 ? `${wl} · ${ordinal(place)}` : wl;
}

export interface WeekSide {
  /** Starts already made: past days, and today's starters whose game has begun. */
  startsSoFar: number;
  /** Projected starts still to come: today's starters yet to play, and the days ahead. */
  startsLeft: number;
  pointsSoFar: number;
  pointsLeft: number;
  /** Points per start so far (null before any). */
  perStartSoFar: number | null;
  /** Projected points per start still to come (null when none are left). */
  perStartLeft: number | null;
}

export function weekSide(a: {
  pastStarts: number;
  todayStarted: number;
  todayLeft: number;
  aheadStarts: number;
  banked: number;
  remaining: number;
}): WeekSide {
  const startsSoFar = a.pastStarts + a.todayStarted;
  const startsLeft = a.todayLeft + a.aheadStarts;
  return {
    startsSoFar,
    startsLeft,
    pointsSoFar: a.banked,
    pointsLeft: a.remaining,
    perStartSoFar: startsSoFar ? a.banked / startsSoFar : null,
    perStartLeft: startsLeft ? a.remaining / startsLeft : null,
  };
}
