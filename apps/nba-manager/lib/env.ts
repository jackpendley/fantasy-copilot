import "server-only";
import type { EspnConfig } from "@fantasy-copilot/espn";

export class SetupError extends Error {}

export function espnConfig(): EspnConfig & { teamId: number } {
  const { ESPN_S2, ESPN_SWID, ESPN_LEAGUE_ID, ESPN_TEAM_ID, ESPN_SEASON } = process.env;
  if (!ESPN_S2 || !ESPN_SWID || !ESPN_LEAGUE_ID || !ESPN_TEAM_ID) {
    throw new SetupError("ESPN_S2, ESPN_SWID, ESPN_LEAGUE_ID and ESPN_TEAM_ID must be set");
  }
  return {
    s2: ESPN_S2,
    swid: ESPN_SWID,
    leagueId: ESPN_LEAGUE_ID,
    teamId: Number(ESPN_TEAM_ID),
    season: Number(ESPN_SEASON || 2027),
  };
}

/** Where times are shown. Jack is in Arizona (MST all year). */
export const DISPLAY_TZ = process.env.DISPLAY_TZ || "America/Phoenix";
