// A box score (ESPN site API `summary`) as per-side player stat lines, in the abbreviations league
// scoring uses (as parseGameLog's), for scripts/fetch-history-boxscores.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */
/** "9-15" -> [9, 15] */
const pair = (v: string) => {
  const [a, b] = String(v).split("-").map(Number);
  return [a || 0, b || 0] as const;
};

/** A box score's stat names -> the abbreviations league scoring uses (as parseGameLog's). */
export function toLine(keys: string[], stats: string[]): Record<string, number> {
  const line: Record<string, number> = {};
  keys.forEach((k, i) => {
    const v = stats[i] ?? "0";
    if (k === "minutes") line.MIN = Number(v) || 0;
    else if (k === "points") line.PTS = Number(v) || 0;
    else if (k === "fieldGoalsMade-fieldGoalsAttempted") [line.FGM, line.FGA] = pair(v);
    else if (k === "threePointFieldGoalsMade-threePointFieldGoalsAttempted")
      [line["3PM"], line["3PA"]] = pair(v);
    else if (k === "freeThrowsMade-freeThrowsAttempted") [line.FTM, line.FTA] = pair(v);
    else if (k === "rebounds") line.REB = Number(v) || 0;
    else if (k === "assists") line.AST = Number(v) || 0;
    else if (k === "steals") line.STL = Number(v) || 0;
    else if (k === "blocks") line.BLK = Number(v) || 0;
    else if (k === "turnovers") line.TO = Number(v) || 0;
    else if (k === "fouls") line.PF = Number(v) || 0;
  });
  return line;
}

export interface BoxGame {
  gameId: number;
  date: string;
  /** Per side: its team, its opponent, home or away, and each player who played. */
  sides: {
    team: string;
    opponent: string;
    home: boolean;
    players: { id: number; pos: string; line: Record<string, number> }[];
  }[];
}

export function parseBox(gameId: number, data: any): BoxGame {
  const comp = data.header?.competitions?.[0];
  const home = new Map<string, boolean>(
    (comp?.competitors ?? []).map((c: any) => [c.team?.abbreviation, c.homeAway === "home"]),
  );
  const teams = (data.boxscore?.players ?? []).map((t: any) => t.team?.abbreviation as string);
  if (teams.length !== 2 || !comp?.date) throw new Error(`game ${gameId}: no box score`);
  return {
    gameId,
    date: comp.date,
    sides: (data.boxscore.players as any[]).map((t, i) => {
      const st = t.statistics?.[0] ?? {};
      return {
        team: teams[i]!,
        opponent: teams[1 - i]!,
        home: home.get(teams[i]!) ?? false,
        players: (st.athletes ?? [])
          .filter((a: any) => !a.didNotPlay && (a.stats ?? []).length)
          .map((a: any) => ({
            id: Number(a.athlete.id),
            pos: a.athlete.position?.abbreviation ?? "",
            line: toLine(st.keys ?? [], a.stats),
          })),
      };
    }),
  };
}
