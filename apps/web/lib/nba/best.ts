import "server-only";
// The projection shown under scores and used for today's lineups: our model, or the props
// blend for players with Vegas lines once it has passed its pre-registered test
// (lib/nba/accuracy.ts). Returns nothing while the blend weight is 0, so pages cost nothing extra.

import type { LeagueSettings, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import type { ScoreboardGame } from "@fantasy-copilot/nba-data";
import { bestProjection, blendSetting } from "./accuracy";
import { propsForGames } from "./market-data";
import { gameEnvironment, perGameProjection } from "./projection";
import { vegasProjection } from "./vegas";

export async function bestPerGame(
  players: RosterPlayer[],
  data: { games: ProGame[]; scoreboard: ScoreboardGame[]; settings: LeagueSettings },
  sp: number,
): Promise<Map<number, number> | undefined> {
  const weight = (await blendSetting().catch(() => null))?.weight ?? 0;
  if (weight <= 0) return undefined;
  const today = data.games.filter((g) => g.scoringPeriodId === sp);
  const props = await propsForGames(today.map((g) => g.gameId)).catch(() => new Map());
  const out = new Map<number, number>();
  for (const p of players) {
    const g = today.find((x) => x.homeProTeamId === p.proTeamId || x.awayProTeamId === p.proTeamId);
    if (!g) continue;
    const base = perGameProjection(p, sp).fppg;
    const ours =
      base *
      gameEnvironment(
        data.scoreboard.find((s) => s.gameId === g.gameId),
        g.homeProTeamId === p.proTeamId,
      );
    const vegas = vegasProjection(
      props.get(p.id) ?? [],
      p.projection?.stats,
      base,
      data.settings.scoring,
    );
    out.set(p.id, bestProjection(ours, vegas?.fppg ?? null, weight));
  }
  return out;
}
