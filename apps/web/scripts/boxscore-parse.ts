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

/**
 * A season's games as the event code should see them. ESPN keeps empty records (no players: in
 * some older seasons a game exists again under a second id, often with a missing or
 * spelled-out team name), and could keep a game twice. From 2012-13 it gives no minutes ("--")
 * for any Chicago or New Orleans side, and now and then for one player beside teammates who
 * have them. The event code counts a game as played only with minutes, so such a player would
 * look absent: a side where any player with stats lacks minutes is treated as missing (its
 * players are dropped from that game; it can't then fake an absence; the other side stays).
 * Dropped: a record where a side has no players, a side lacking minutes, a game with a team
 * that isn't the season's (40+ appearances), and an exact duplicate (within 2 days, 10+ shared
 * players, every shared line identical; the lower id is kept). Two real games between the same
 * teams on consecutive days share players but not lines, so both stay.
 */
export function cleanSeason(games: BoxGame[]): {
  kept: BoxGame[];
  empty: number;
  noMinutes: number;
  odd: number;
  duplicates: number;
} {
  const appearances = new Map<string, number>();
  for (const g of games)
    for (const s of g.sides) appearances.set(s.team, (appearances.get(s.team) ?? 0) + 1);
  const withPlayers = games.filter((g) => g.sides.every((s) => s.players.length));
  const played = (l: Record<string, number>) =>
    (l.PTS ?? 0) + (l.REB ?? 0) + (l.AST ?? 0) + (l.FGA ?? 0) + (l.FTA ?? 0) > 0;
  const sideOk = (s: BoxGame["sides"][number]) =>
    s.players.some((p) => (p.line.MIN ?? 0) > 0) &&
    s.players.every((p) => (p.line.MIN ?? 0) > 0 || !played(p.line));
  // A side lacking minutes loses its players; a game left with neither side is dropped.
  let noMinutes = 0;
  const withMinutes = withPlayers
    .map((g) => {
      const bad = g.sides.filter((s) => !sideOk(s)).length;
      noMinutes += bad;
      return bad ? { ...g, sides: g.sides.map((s) => (sideOk(s) ? s : { ...s, players: [] })) } : g;
    })
    .filter((g) => g.sides.some((s) => s.players.length));
  const real = withMinutes.filter((g) =>
    g.sides.every((s) => s.team && (appearances.get(s.team) ?? 0) >= 40),
  );
  const byTime = [...real].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date) || a.gameId - b.gameId,
  );
  const lines = new Map(
    byTime.map((g) => [
      g.gameId,
      new Map(g.sides.flatMap((s) => s.players.map((p) => [p.id, JSON.stringify(p.line)]))),
    ]),
  );
  const dropped = new Set<number>();
  for (let i = 0; i < byTime.length; i++) {
    for (let j = i + 1; j < byTime.length; j++) {
      const a = byTime[i]!;
      const b = byTime[j]!;
      if (Date.parse(b.date) - Date.parse(a.date) > 2 * 86_400_000) break;
      const la = lines.get(a.gameId)!;
      const lb = lines.get(b.gameId)!;
      const shared = [...la.keys()].filter((id) => lb.has(id));
      if (shared.length >= 10 && shared.every((id) => la.get(id) === lb.get(id)))
        dropped.add(Math.max(a.gameId, b.gameId));
    }
  }
  return {
    kept: real.filter((g) => !dropped.has(g.gameId)),
    empty: games.length - withPlayers.length,
    noMinutes,
    odd: withMinutes.length - real.length,
    duplicates: dropped.size,
  };
}
