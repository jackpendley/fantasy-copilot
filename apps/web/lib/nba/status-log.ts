import "server-only";
// The status_events log (lib/nba/news.ts says what each source reports): statuses are held per
// server instance with when they were first seen, and stored together (the 5-minute job stores
// every 30 minutes, so Neon sleeps between; docs/COMPUTE.md §10).

import { db } from "@/lib/db";
import type { StatusEvent } from "./news";

/**
 * Hold status events not stored yet, with when they were first seen (a status is stored once
 * per source and game day until it changes). Returns how many are new. The 5-minute job sees
 * the same statuses all day: a query each run would keep Neon awake for nothing.
 */
export function holdStatusEvents(events: StatusEvent[], now: Date): number {
  let added = 0;
  for (const e of events) {
    const key = eventKey(e);
    if (storedEvents.has(key) || heldEvents.has(key)) continue;
    heldEvents.set(key, { ...e, observedAt: now });
    added++;
  }
  return added;
}

/** Store the held status events; the players with a new one. */
export async function storeStatusEvents(): Promise<number[]> {
  const held = [...heldEvents];
  if (!held.length) return [];
  const rows = held.map(([, e]) => ({
    player_id: e.playerId,
    source: e.source,
    status: e.status,
    detail: e.detail,
    published_at: e.publishedAt,
    observed_at: e.observedAt,
    game_date: e.gameDate,
    return_date: e.returnDate ?? null,
  }));
  const inserted = await db()`
    insert into status_events ${db()(
      rows,
      "player_id",
      "source",
      "status",
      "detail",
      "published_at",
      "observed_at",
      "game_date",
      "return_date",
    )}
    on conflict do nothing
    returning player_id
  `;
  // Inserted or already there: either way it's stored now.
  if (storedEvents.size > 20_000) storedEvents.clear();
  for (const [key] of held) {
    storedEvents.add(key);
    heldEvents.delete(key);
  }
  return inserted.map((r) => r.player_id as number);
}

/** Whether this instance holds status events not stored yet. */
export const statusHeld = () => heldEvents.size > 0;

/** Status events known to be stored, by the table's dedupe key (per server instance). */
const storedEvents = new Set<string>();
/** Status events seen but not stored yet, with when they were first seen (per server instance). */
const heldEvents = new Map<string, StatusEvent & { observedAt: Date }>();
const eventKey = (e: StatusEvent) =>
  [e.playerId, e.source, e.status, e.gameDate, e.returnDate ?? ""].join("|");
