// ESPN's public site API (no cookies): scoreboard, injuries, game summaries. Team ids and
// game ids are the same ones the fantasy API uses, and athlete ids are fantasy player ids.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

async function getJson(url: string, fetchImpl: typeof fetch): Promise<Json> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN site ${res.status} for ${url}`);
  return res.json();
}

export type GameState = "pre" | "in" | "post";

export interface ScoreboardGame {
  gameId: number;
  /** Tip-off, ISO. */
  tip: string;
  state: GameState;
  detail: string;
  /** Quarter (5+ = overtime) and game clock ("5:12"), while in progress. */
  period: number;
  clock: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  /** Home spread as posted (negative = home favored), and the game total. */
  spread: number | null;
  total: number | null;
}

/** yyyymmdd, e.g. "20261020" (US/Eastern game date, as ESPN groups them). */
export function parseScoreboard(data: Json): ScoreboardGame[] {
  return (data?.events ?? []).map((e: Json) => {
    const c = e.competitions?.[0] ?? {};
    const side = (h: string) => c.competitors?.find((x: Json) => x.homeAway === h) ?? {};
    const home = side("home");
    const away = side("away");
    const odds = c.odds?.[0];
    const score = (x: Json) =>
      e.status?.type?.state === "pre" || x.score == null ? null : Number(x.score);
    return {
      gameId: Number(e.id),
      tip: e.date,
      state: (e.status?.type?.state ?? "pre") as GameState,
      detail: e.status?.type?.shortDetail ?? "",
      period: Number(e.status?.period ?? 0),
      clock: e.status?.displayClock ?? "",
      homeTeamId: Number(home.team?.id),
      awayTeamId: Number(away.team?.id),
      homeScore: score(home),
      awayScore: score(away),
      spread: typeof odds?.spread === "number" ? odds.spread : null,
      total: typeof odds?.overUnder === "number" ? odds.overUnder : null,
    };
  });
}

export async function fetchScoreboard(yyyymmdd: string, fetchImpl: typeof fetch = fetch) {
  return parseScoreboard(await getJson(`${SITE}/scoreboard?dates=${yyyymmdd}`, fetchImpl));
}

export interface InjuryReport {
  playerId: number;
  name: string;
  teamId: number | null;
  /** As ESPN words it: "Out", "Day-To-Day", "Questionable"... */
  status: string;
  short: string;
  long: string;
  /** When ESPN posted this note, ISO. */
  date: string;
  /**
   * ESPN's estimated return date ("2026-11-09"), when it gives one: a projection from the
   * reported timeline (re-evaluated in two weeks, out 6-8 weeks, out for the season).
   */
  returnDate?: string | null;
  /** Injury type and detail, e.g. "Hamstring" / "Strain". */
  injury?: string | null;
}

const idFromLinks = (links: Json[] | undefined): number | null => {
  for (const l of links ?? []) {
    const m = /\/id\/(\d+)/.exec(l?.href ?? "");
    if (m) return Number(m[1]);
  }
  return null;
};

export function parseInjuries(data: Json): InjuryReport[] {
  const out: InjuryReport[] = [];
  for (const team of data?.injuries ?? []) {
    for (const i of team.injuries ?? []) {
      const playerId = Number(i.athlete?.id) || idFromLinks(i.athlete?.links);
      if (!playerId) continue;
      out.push({
        playerId,
        name: i.athlete?.displayName ?? "",
        teamId: Number(team.id) || null,
        status: i.status ?? "",
        short: i.shortComment ?? "",
        long: i.longComment ?? "",
        date: i.date ?? "",
        returnDate: /^\d{4}-\d{2}-\d{2}/.test(i.details?.returnDate ?? "")
          ? i.details.returnDate.slice(0, 10)
          : null,
        injury: [i.details?.type, i.details?.detail].filter(Boolean).join(" / ") || null,
      });
    }
  }
  return out;
}

export async function fetchInjuries(fetchImpl: typeof fetch = fetch) {
  return parseInjuries(await getJson(`${SITE}/injuries`, fetchImpl));
}

export async function fetchGameSummary(
  gameId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Json> {
  return getJson(`${SITE}/summary?event=${gameId}`, fetchImpl);
}

export interface BoxScoreLine {
  playerId: number;
  teamId: number;
  /** MIN, PTS, FGM, FGA, 3PM, 3PA, FTM, FTA, REB, AST, TO, STL, BLK, PF (players who played). */
  line: Record<string, number>;
}

/** Every player who has played in a game (live or finished), from the summary's box score. */
export function parseBoxScore(summary: Json): BoxScoreLine[] {
  const out: BoxScoreLine[] = [];
  const made = (v: string) => String(v).split("-").map(Number) as [number, number];
  for (const team of summary?.boxscore?.players ?? []) {
    const block = team.statistics?.[0];
    const names: string[] = block?.names ?? [];
    for (const a of block?.athletes ?? []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const line: Record<string, number> = {};
      names.forEach((n, i) => {
        const v = a.stats[i] ?? "0";
        if (n === "FG") [line.FGM, line.FGA] = made(v);
        else if (n === "3PT") [line["3PM"], line["3PA"]] = made(v);
        else if (n === "FT") [line.FTM, line.FTA] = made(v);
        else if (["MIN", "PTS", "REB", "AST", "TO", "STL", "BLK", "PF"].includes(n))
          line[n] = Number(v) || 0;
      });
      out.push({ playerId: Number(a.athlete?.id), teamId: Number(team.team?.id), line });
    }
  }
  return out;
}
