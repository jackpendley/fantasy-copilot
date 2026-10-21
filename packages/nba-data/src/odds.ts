// Sportsbook player props from ESPN's public core API (DraftKings, provider 100). Free and
// cookie-less, like the site API; athlete ids are fantasy player ids. ESPN drops props once a
// season is over, so they have to be collected as the season goes.
//
// Each prop comes as two unlabeled prices. The first is the over: on opening night its price
// matched the one-sided "X+" milestone at the same threshold in 107 of 112 props (ADR-023).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba";
/** DraftKings in ESPN's odds feed. */
export const PROPS_PROVIDER = 100;

export type PropMarket = "PTS" | "REB" | "AST" | "3PM" | "STL" | "BLK";

const MARKETS: Record<string, PropMarket> = {
  "Total Points": "PTS",
  "Total Rebounds": "REB",
  "Total Assists": "AST",
  "Total 3-Point Field Goals": "3PM",
  "Total Steals": "STL",
  "Total Blocks": "BLK",
};

export interface PropLine {
  playerId: number;
  market: PropMarket;
  /** Over/under threshold, e.g. 22.5. */
  line: number;
  /** Decimal prices (2.10 = +110). */
  over: number;
  under: number;
  /** Where the line opened. */
  openLine: number | null;
  /** When the book last moved it, ISO. */
  updatedAt: string | null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Over/under pairs for the single-stat markets; anything incomplete is skipped. */
export function parsePropBets(data: Json): PropLine[] {
  const pairs = new Map<string, Json[]>();
  for (const item of data?.items ?? []) {
    const market = MARKETS[item?.type?.name];
    const id = /athletes\/(\d+)/.exec(item?.athlete?.$ref ?? "")?.[1];
    if (!market || !id) continue;
    const key = `${id}|${market}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key)!.push(item);
  }
  const out: PropLine[] = [];
  for (const [key, items] of pairs) {
    if (items.length !== 2) continue;
    const [id, market] = key.split("|");
    const line = num(items[0].current?.target?.value);
    const over = num(items[0].odds?.decimal?.value);
    const under = num(items[1].odds?.decimal?.value);
    if (line == null || !over || !under || items[1].current?.target?.value !== line) continue;
    out.push({
      playerId: Number(id),
      market: market as PropMarket,
      line,
      over,
      under,
      openLine: num(items[0].open?.target?.value),
      updatedAt: items[0].lastUpdated ?? null,
    });
  }
  return out;
}

/** Props for one game (ESPN event id = game id). No props posted yet → []. */
export async function fetchPropBets(
  gameId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<PropLine[]> {
  const url = `${CORE}/events/${gameId}/competitions/${gameId}/odds/${PROPS_PROVIDER}/propBets?limit=1000`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`ESPN odds ${res.status} for game ${gameId}`);
  return parsePropBets(await res.json());
}

/** Bookmaker probability of the over with the margin removed (prices are decimal). */
export function noVigOver(over: number, under: number): number {
  const po = 1 / over;
  const pu = 1 / under;
  return po / (po + pu);
}
