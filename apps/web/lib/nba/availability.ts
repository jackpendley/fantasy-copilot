// Who can play when: ESPN's injury feed estimates a return date for every injured player
// ("re-evaluated in two weeks" -> Nov 9, "out for the season" -> March). Season-long numbers
// (trades, waivers, league strength, the outlook) leave a player out until that day. Pure.

import type { RosterPlayer } from "@fantasy-copilot/espn";
import { normalizeStatus } from "@fantasy-copilot/fantasy-core";
import type { InjuryReport } from "@fantasy-copilot/nba-data";
import { LAST_SCORING_PERIOD, scoringPeriodForDate } from "./calendar";

const OUT = new Set(["OUT", "INJURY_RESERVE", "SUSPENSION"]);

export interface Absence {
  /** First scoring period he can play again. */
  outUntil: number;
  /** ESPN's estimated return date, if it gave one. */
  returnDate: string | null;
  /** Not back before the end of the fantasy season. */
  season: boolean;
}

/** Ruled out with no estimated return: assume a week (re-read every day, so it self-corrects). */
const UNKNOWN_ABSENCE_DAYS = 7;

/**
 * A player's current absence, if he's ruled out. ESPN estimates a return date for nearly every
 * ruled-out player; without one, assume a week. A date that has passed while he's still out
 * means "any day now": tomorrow. Day-to-day and questionable players aren't absences: the
 * daily play chances cover them.
 */
export function absenceOf(
  player: Pick<RosterPlayer, "id" | "injuryStatus">,
  report: Pick<InjuryReport, "status" | "returnDate"> | undefined,
  today: number,
): Absence | null {
  const status = normalizeStatus(report?.status ?? player.injuryStatus);
  if (!OUT.has(status)) return null;
  const returnDate = report?.returnDate ?? null;
  const back = returnDate ? scoringPeriodForDate(returnDate) : today + UNKNOWN_ABSENCE_DAYS;
  const outUntil = Math.max(back, today + 1);
  return { outUntil, returnDate, season: outUntil > LAST_SCORING_PERIOD };
}

/** Absences for a set of players, by id. */
export function absences(
  players: Pick<RosterPlayer, "id" | "injuryStatus">[],
  injuries: Pick<InjuryReport, "playerId" | "status" | "returnDate">[],
  today: number,
): Map<number, Absence> {
  const byId = new Map(injuries.map((i) => [i.playerId, i]));
  const out = new Map<number, Absence>();
  for (const p of players) {
    const a = absenceOf(p, byId.get(p.id), today);
    if (a) out.set(p.id, a);
  }
  return out;
}

/** "back ~Nov 9", "out for the season", or "out" for display. */
export function returnLabel(a: Absence): string {
  if (a.season) return "out for the season";
  if (!a.returnDate) return "out";
  const d = new Date(`${a.returnDate}T12:00:00Z`);
  return `back ~${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}
