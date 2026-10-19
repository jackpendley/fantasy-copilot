// Player status as each source reports it, for the status_events log. Comparing when each
// source first showed a change measures which free feed is fastest (news latency), and the
// history becomes labels for the availability model.

import type { RosterPlayer } from "@fantasy-copilot/espn";
import { normalizeStatus } from "@fantasy-copilot/fantasy-core";
import {
  buildMatcher,
  toEspnTeam,
  type InjuryReport,
  type LineupEntry,
} from "@fantasy-copilot/nba-data";

export interface StatusEvent {
  playerId: number;
  source: "espn_injuries" | "nba_lineups" | "espn_fantasy";
  status: string;
  detail: string | null;
  /** When the source says it published this, ISO (null when it doesn't say). */
  publishedAt: string | null;
  /** US/Eastern game date the observation was made for. */
  gameDate: string;
}

export function statusEventsFrom(input: {
  /** Every rostered player in the league (the players whose news matters). */
  rostered: RosterPlayer[];
  injuries: InjuryReport[];
  lineups: LineupEntry[] | null;
  gameDate: string;
}): StatusEvent[] {
  const ids = new Set(input.rostered.map((p) => p.id));
  const out: StatusEvent[] = [];

  for (const i of input.injuries) {
    if (!ids.has(i.playerId)) continue;
    out.push({
      playerId: i.playerId,
      source: "espn_injuries",
      status: normalizeStatus(i.status),
      detail: i.short || null,
      publishedAt: i.date || null,
      gameDate: input.gameDate,
    });
  }

  for (const p of input.rostered) {
    const s = normalizeStatus(p.injuryStatus);
    if (s === "ACTIVE") continue;
    out.push({
      playerId: p.id,
      source: "espn_fantasy",
      status: s,
      detail: null,
      publishedAt: null,
      gameDate: input.gameDate,
    });
  }

  const match = buildMatcher(
    input.rostered.map((p) => ({ id: p.id, name: p.name, team: p.proTeam })),
  );
  for (const e of input.lineups ?? []) {
    const id = match(e.name, toEspnTeam(e.team));
    if (id == null) continue;
    const status =
      e.rosterStatus === "Inactive"
        ? "INACTIVE"
        : e.starter
          ? `STARTER_${(e.lineupStatus || "expected").toUpperCase()}`
          : null;
    if (!status) continue;
    out.push({
      playerId: id,
      source: "nba_lineups",
      status,
      // NBA.com's timestamp has no zone (US/Eastern); kept verbatim rather than guessed.
      detail: e.timestamp ? `nba.com ${e.timestamp} ET` : null,
      publishedAt: null,
      gameDate: input.gameDate,
    });
  }
  return out;
}
