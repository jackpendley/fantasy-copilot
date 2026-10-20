// A player's game log from ESPN's public athlete API (no cookies). Athlete ids are the same
// ids the fantasy API uses. Each game becomes a stat line in the abbreviations league scoring
// uses (FGM, FGA, 3PM, ... PTS), so fantasy points come from fantasyPoints(withDerived(line)).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export type SeasonPart = "regular" | "post" | "pre";

export interface GameLogEntry {
  gameId: number;
  /** Tip-off, ISO. */
  date: string;
  opponent: string;
  home: boolean;
  /** "W" | "L" | "" */
  result: string;
  score: string;
  part: SeasonPart;
  line: Record<string, number>;
}

const partOf = (name: string): SeasonPart | null =>
  /Regular/i.test(name)
    ? "regular"
    : /Postseason|Playoff/i.test(name)
      ? "post"
      : /Preseason/i.test(name)
        ? "pre"
        : null;

/** "9-15" -> [9, 15] */
const pair = (v: string) => {
  const [a, b] = String(v).split("-").map(Number);
  return [a ?? 0, b ?? 0] as const;
};

function toLine(names: string[], stats: string[]): Record<string, number> {
  const line: Record<string, number> = {};
  names.forEach((name, i) => {
    const v = stats[i] ?? "0";
    switch (name) {
      case "minutes":
        line.MIN = Number(v) || 0;
        break;
      case "fieldGoalsMade-fieldGoalsAttempted":
        [line.FGM, line.FGA] = pair(v);
        break;
      case "threePointFieldGoalsMade-threePointFieldGoalsAttempted":
        [line["3PM"], line["3PA"]] = pair(v);
        break;
      case "freeThrowsMade-freeThrowsAttempted":
        [line.FTM, line.FTA] = pair(v);
        break;
      case "totalRebounds":
        line.REB = Number(v) || 0;
        break;
      case "assists":
        line.AST = Number(v) || 0;
        break;
      case "blocks":
        line.BLK = Number(v) || 0;
        break;
      case "steals":
        line.STL = Number(v) || 0;
        break;
      case "fouls":
        line.PF = Number(v) || 0;
        break;
      case "turnovers":
        line.TO = Number(v) || 0;
        break;
      case "points":
        line.PTS = Number(v) || 0;
        break;
    }
  });
  return line;
}

/** Oldest game first. */
export function parseGameLog(data: Json): GameLogEntry[] {
  const names: string[] = data?.names ?? [];
  const out: GameLogEntry[] = [];
  for (const st of data?.seasonTypes ?? []) {
    const part = partOf(st.displayName ?? "");
    if (!part) continue;
    for (const cat of st.categories ?? []) {
      if (cat.type !== "event") continue;
      for (const row of cat.events ?? []) {
        const ev = data.events?.[row.eventId];
        if (!ev) continue;
        out.push({
          gameId: Number(row.eventId),
          date: ev.gameDate,
          opponent: ev.opponent?.abbreviation ?? "?",
          home: ev.atVs === "vs",
          result: ev.gameResult ?? "",
          score: ev.score ?? "",
          part,
          line: toLine(names, row.stats ?? []),
        });
      }
    }
  }
  return out.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** season = the year the NBA season ends (2027 for 2026-27). */
export async function fetchGameLog(
  athleteId: number,
  season: number,
  fetchImpl: typeof fetch = fetch,
) {
  const res = await fetchImpl(
    `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}/gamelog?season=${season}`,
    { headers: { Accept: "application/json" } },
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`ESPN gamelog ${res.status}`);
  return parseGameLog(await res.json());
}
