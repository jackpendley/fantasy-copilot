import "server-only";
// NBA.com's daily lineups as they change before each game (lineup_log, migration 0034): every
// player NBA.com lists, not only rostered ones, so who was inactive is known for every team.
// Held per server instance with when each state was first seen, stored with the other held
// logs (docs/COMPUTE.md §10), like status_events (lib/nba/status-log.ts).

import type { LineupEntry } from "@fantasy-copilot/nba-data";
import { toEspnTeam } from "@fantasy-copilot/nba-data";
import { db } from "@/lib/db";

interface LineupRow {
  game_date: string;
  nba_game_id: string;
  team: string;
  nba_person_id: number;
  name: string;
  inactive: boolean;
  starter: boolean;
  confirmed: boolean;
  nba_timestamp: string | null;
  observed_at: Date;
}

const held = new Map<string, LineupRow>();
const stored = new Set<string>();

/** One row per state a player-game is seen in (the table's key). */
const keyOf = (
  r: Pick<LineupRow, "nba_game_id" | "nba_person_id" | "inactive" | "starter" | "confirmed">,
) => `${r.nba_game_id}:${r.nba_person_id}:${+r.inactive}${+r.starter}${+r.confirmed}`;

/** Hold the lineup states not seen before; returns how many are new. */
export function holdLineups(entries: LineupEntry[] | null, gameDate: string, now: Date): number {
  let added = 0;
  for (const e of entries ?? []) {
    const row: LineupRow = {
      game_date: gameDate,
      nba_game_id: e.gameId,
      team: toEspnTeam(e.team),
      nba_person_id: e.nbaPersonId,
      name: e.name,
      inactive: e.rosterStatus === "Inactive",
      starter: e.starter,
      confirmed: e.lineupStatus === "Confirmed",
      // NBA.com's timestamp has no zone (US/Eastern): kept verbatim rather than guessed.
      nba_timestamp: e.timestamp,
      observed_at: now,
    };
    const key = keyOf(row);
    if (stored.has(key) || held.has(key)) continue;
    held.set(key, row);
    added++;
  }
  return added;
}

export const lineupsHeld = () => held.size > 0;

/** Store the held lineup states; returns how many rows were new. */
export async function storeLineups(): Promise<number> {
  const rows = [...held.values()];
  if (!rows.length) return 0;
  const inserted = await db()`
    insert into lineup_log ${db()(
      rows,
      "game_date",
      "nba_game_id",
      "team",
      "nba_person_id",
      "name",
      "inactive",
      "starter",
      "confirmed",
      "nba_timestamp",
      "observed_at",
    )}
    on conflict do nothing
    returning 1
  `;
  if (stored.size > 20_000) stored.clear();
  for (const r of rows) {
    const key = keyOf(r);
    stored.add(key);
    held.delete(key);
  }
  return inserted.length;
}
