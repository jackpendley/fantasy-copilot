// DARKO (darko.app) daily player projections: per-100-possession box-score rates plus
// projected minutes and pace. Read from the projections page's data endpoint (SvelteKit
// "devalue" JSON), once a day. No stated terms; snapshots are kept with DARKO's own as-of date.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const URL_DATA = "https://www.darko.app/projections/__data.json";

export interface DarkoPlayer {
  nbaId: number;
  name: string;
  team: string;
  /** Projected minutes and possessions per 48 minutes. */
  minutes: number;
  pace: number;
  /** Per 100 possessions. */
  per100: Record<string, number>;
  fgPct: number | null;
  fg3Pct: number | null;
  ftPct: number | null;
}

/** devalue's negative indices: undefined, hole, NaN, Infinity, -Infinity, -0. */
const SPECIAL: Record<number, number | undefined> = {
  [-1]: undefined,
  [-2]: undefined,
  [-3]: NaN,
  [-4]: Infinity,
  [-5]: -Infinity,
  [-6]: -0,
};

/** Rebuild a SvelteKit devalue payload (a flat array where objects point at other entries). */
export function unflatten(flat: Json[]): Json {
  const memo = new Map<number, Json>();
  const at = (i: number): Json => {
    if (i < 0) return SPECIAL[i];
    if (memo.has(i)) return memo.get(i);
    const v = flat[i];
    if (v === null || typeof v !== "object") {
      memo.set(i, v);
      return v;
    }
    if (Array.isArray(v)) {
      // ["Date", "2026-07-26"] and similar typed values: keep the raw payload.
      if (typeof v[0] === "string") {
        memo.set(i, v[1]);
        return v[1];
      }
      const arr: Json[] = [];
      memo.set(i, arr);
      for (const x of v) arr.push(at(x));
      return arr;
    }
    const o: Json = {};
    memo.set(i, o);
    for (const [k, x] of Object.entries(v)) o[k] = at(x as number);
    return o;
  };
  return at(0);
}

const RATES = ["pts", "ast", "orb", "drb", "stl", "blk", "tov", "fga", "fg3a", "fta"];

export function parseDarko(data: Json): { asOf: string | null; players: DarkoPlayer[] } {
  const node = (data?.nodes ?? []).find((n: Json) => n?.type === "data" && Array.isArray(n.data));
  if (!node) return { asOf: null, players: [] };
  const root = unflatten(node.data);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const players: DarkoPlayer[] = [];
  for (const p of root?.players ?? []) {
    const minutes = n(p.x_minutes);
    const pace = n(p.x_pace);
    if (!p.nba_id || minutes == null || pace == null) continue;
    const per100: Record<string, number> = {};
    for (const r of RATES) {
      const v = n(p[`x_${r}_100`]);
      if (v != null) per100[r] = v;
    }
    players.push({
      nbaId: Number(p.nba_id),
      name: String(p.player_name ?? ""),
      team: String(p.team_name ?? ""),
      minutes,
      pace,
      per100,
      fgPct: n(p.x_fg_pct),
      fg3Pct: n(p.x_fg3_pct),
      ftPct: n(p.x_ft_pct),
    });
  }
  return { asOf: typeof root?.asOf === "string" ? root.asOf : null, players };
}

export async function fetchDarko(fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(URL_DATA, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DARKO ${res.status}`);
  return parseDarko(await res.json());
}

/** A DARKO projection as per-game box-score stats (the names the fantasy scoring uses). */
export function darkoPerGame(p: DarkoPlayer): Record<string, number> {
  const poss = (p.pace * p.minutes) / 48 / 100;
  const r = (k: string) => (p.per100[k] ?? 0) * poss;
  const fga = r("fga");
  const fg3a = r("fg3a");
  const fta = r("fta");
  return {
    MIN: p.minutes,
    PTS: r("pts"),
    REB: r("orb") + r("drb"),
    AST: r("ast"),
    STL: r("stl"),
    BLK: r("blk"),
    TO: r("tov"),
    FGA: fga,
    FGM: fga * (p.fgPct ?? 0),
    "3PA": fg3a,
    "3PM": fg3a * (p.fg3Pct ?? 0),
    FTA: fta,
    FTM: fta * (p.ftPct ?? 0),
  };
}
