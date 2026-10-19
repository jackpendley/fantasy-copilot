// ESPN's unofficial fantasy API v3. A private league needs the signed-in user's
// espn_s2 + SWID cookies; this client is for server code only.

import { READ_HOST } from "./constants";

export interface EspnConfig {
  s2: string;
  swid: string;
  leagueId: string | number;
  season: number;
  game?: "fba";
}

export class EspnError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const leaguePath = (cfg: EspnConfig) =>
  `/apis/v3/games/${cfg.game ?? "fba"}/seasons/${cfg.season}/segments/0/leagues/${cfg.leagueId}`;

export interface FetchOptions {
  scoringPeriodId?: number;
  /** Sent as the X-Fantasy-Filter header (player queries). */
  filter?: unknown;
  fetchImpl?: typeof fetch;
}

/** GET the league with the given views, e.g. ["mSettings", "mRoster"]. */
export async function fetchLeague(
  cfg: EspnConfig,
  views: readonly string[],
  opts: FetchOptions = {},
): Promise<unknown> {
  const params = new URLSearchParams();
  for (const v of views) params.append("view", v);
  if (opts.scoringPeriodId != null) params.set("scoringPeriodId", String(opts.scoringPeriodId));
  const url = `${READ_HOST}${leaguePath(cfg)}?${params}`;
  const headers: Record<string, string> = {
    Cookie: `espn_s2=${cfg.s2}; SWID=${cfg.swid}`,
    Accept: "application/json",
  };
  if (opts.filter) headers["X-Fantasy-Filter"] = JSON.stringify(opts.filter);
  const res = await (opts.fetchImpl ?? fetch)(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401 ? " (espn_s2/SWID cookies missing or expired)" : "";
    throw new EspnError(res.status, `ESPN ${res.status}${hint}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** NBA schedule by ESPN scoring period (public; no cookies). */
export async function fetchProSchedule(
  season: number,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const res = await fetchImpl(
    `${READ_HOST}/apis/v3/games/fba/seasons/${season}?view=proTeamSchedules_wl`,
  );
  if (!res.ok) throw new EspnError(res.status, `ESPN pro schedule ${res.status}`);
  return res.json();
}

/** Free agents and waiver players, most-owned first. */
export const freeAgentFilter = (limit = 300) => ({
  players: {
    filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
    limit,
    sortPercOwned: { sortPriority: 1, sortAsc: false },
  },
});
