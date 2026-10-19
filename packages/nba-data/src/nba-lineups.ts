// NBA.com's daily lineups feed: expected/confirmed starters and active/inactive status.
// A static JSON file on stats.nba.com (works from servers, unlike the /stats API),
// published for past dates too, which makes it usable as ML history.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface LineupEntry {
  nbaPersonId: number;
  name: string;
  /** NBA.com team abbreviation (e.g. "GSW"); map with `toEspnTeam`. */
  team: string;
  gameId: string;
  /** "Expected" | "Confirmed": whether the team's lineup is final (bench players included). */
  lineupStatus: string;
  /** "Active" | "Inactive". */
  rosterStatus: string;
  /** Starting position (PG..C); empty for bench players. */
  position: string;
  starter: boolean;
  /** When NBA.com last updated this player, as published (US/Eastern, no zone). */
  timestamp: string | null;
}

// NBA.com abbreviations that differ from ESPN's.
const NBA_TO_ESPN: Record<string, string> = {
  GSW: "GS",
  NOP: "NO",
  NYK: "NY",
  SAS: "SA",
  UTA: "UTAH",
  WAS: "WSH",
  PHO: "PHX",
};
export const toEspnTeam = (abbr: string) => NBA_TO_ESPN[abbr] ?? abbr;

export const dailyLineupsUrl = (yyyymmdd: string) =>
  `https://stats.nba.com/js/data/leaders/00_daily_lineups_${yyyymmdd}.json`;

export function parseDailyLineups(data: Json): LineupEntry[] {
  const out: LineupEntry[] = [];
  for (const g of data?.games ?? []) {
    for (const side of [g.homeTeam, g.awayTeam]) {
      for (const p of side?.players ?? []) {
        out.push({
          nbaPersonId: p.personId,
          name: p.playerName ?? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
          team: side.teamAbbreviation,
          gameId: g.gameId,
          lineupStatus: p.lineupStatus ?? "",
          rosterStatus: p.rosterStatus ?? "",
          position: p.position ?? "",
          starter: Boolean(p.position),
          timestamp: p.timestamp ?? null,
        });
      }
    }
  }
  return out;
}

/** Null when NBA.com has not published the date yet (it answers 403/404). */
export async function fetchDailyLineups(yyyymmdd: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(dailyLineupsUrl(yyyymmdd), {
    headers: {
      Referer: "https://www.nba.com/",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`NBA lineups ${res.status}`);
  return parseDailyLineups(await res.json());
}
