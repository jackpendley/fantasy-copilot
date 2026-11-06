import "server-only";
// Jack's protected players (ADR-060): "Not for trade" keeps a player out of every trade idea
// Jack would give; "Never drop" keeps him out of every drop the app suggests (Moves, the
// simulations, and the cuts a trade would make).

import { db, dbConfigured } from "@/lib/db";

export interface PlayerPrefs {
  noTrade: Set<number>;
  noDrop: Set<number>;
}

export async function loadPrefs(): Promise<PlayerPrefs> {
  const prefs: PlayerPrefs = { noTrade: new Set(), noDrop: new Set() };
  if (!dbConfigured()) return prefs;
  const rows = await db()<{ player_id: number; no_trade: boolean; no_drop: boolean }[]>`
    select player_id, no_trade, no_drop from player_prefs where no_trade or no_drop
  `;
  for (const r of rows) {
    if (r.no_trade) prefs.noTrade.add(r.player_id);
    if (r.no_drop) prefs.noDrop.add(r.player_id);
  }
  return prefs;
}

export async function setPref(playerId: number, field: "noTrade" | "noDrop", on: boolean) {
  const row = { player_id: playerId, no_trade: false, no_drop: false };
  if (field === "noTrade") row.no_trade = on;
  else row.no_drop = on;
  const column = field === "noTrade" ? "no_trade" : "no_drop";
  await db()`
    insert into player_prefs ${db()(row)}
    on conflict (player_id) do update set ${db()(column)} = ${on}, updated_at = now()
  `;
}
