// When a player on the IR slot comes back, someone has to go. The season model (teamValue)
// already decides who: the player who'd add the fewest lineup points from that day on.
// This surfaces that plan for a team.

import type { FantasyTeam, LeagueSettings, ProGame } from "@fantasy-copilot/espn";
import type { InjuryReport } from "@fantasy-copilot/nba-data";
import { absences, returnLabel, type Absence } from "./availability";
import { LAST_SCORING_PERIOD } from "./calendar";
import { teamValue, valueContext, type Activation } from "./trade";

export interface ReturnPlan extends Activation {
  absence: Absence;
}

export function ilReturnPlan(
  team: Pick<FantasyTeam, "roster">,
  data: { games: ProGame[]; settings: LeagueSettings; injuries: InjuryReport[] },
  today: number,
): ReturnPlan[] {
  const injured = absences(team.roster, data.injuries, today);
  if (![...injured.keys()].some((id) => team.roster.find((p) => p.id === id)?.slot === "IR")) {
    return [];
  }
  const ctx = valueContext(
    data.games,
    data.settings.slotCounts,
    today,
    LAST_SCORING_PERIOD,
    data.settings.regularSeasonWeeks,
    injured,
  );
  return teamValue(team.roster, ctx).activations.map((a) => ({
    ...a,
    absence: injured.get(a.player.id)!,
  }));
}

/** "Jalen Duren (IL) back ~Nov 9: you'd drop Day'Ron Sharpe" */
export function describeReturn(r: ReturnPlan, who = "you'd"): string {
  return `${r.player.name} (IL) ${returnLabel(r.absence)}: ${
    r.drop
      ? `${who} drop ${r.drop.name}, who'd add the fewest lineup points from then on`
      : "an open roster spot is waiting"
  }`;
}
