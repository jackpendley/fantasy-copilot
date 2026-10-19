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
