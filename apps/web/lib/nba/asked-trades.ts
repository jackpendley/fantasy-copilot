import "server-only";
// Trades Jack asked to simulate: a watched player's packages, a trade he built, an idea he
// picked. Every job checks them (the first of each ask to the top tier, ADR-060) until one has a
// result settled after the ask, then they drop out. Kept until then, because a newer job (the
// nightly one, his own move) replaces the job that was checking them.

import { db, dbConfigured } from "@/lib/db";
import { readView, writeView } from "@/lib/view-cache";
import { tradeKey, type TradeSpec } from "./sim-moves";

const KEY = "asked-trades";
/** An ask that never got a result (a failed job) is dropped after this long. */
const KEEP_MS = 48 * 3600_000;

export interface AskedTrade {
  key: string;
  spec: TradeSpec;
  /** Checked to the top tier's precision (ADR-060). */
  top: boolean;
  askedAt: string;
}

const specOf = (t: TradeSpec): TradeSpec => ({
  partnerId: t.partnerId,
  give: t.give,
  get: t.get,
  moves: t.moves,
});

const fresh = (list: AskedTrade[], now: number) =>
  list.filter((a) => now - Date.parse(a.askedAt) < KEEP_MS);

async function stored(): Promise<AskedTrade[]> {
  if (!dbConfigured()) return [];
  return (await readView<AskedTrade[]>(KEY).catch(() => null))?.value ?? [];
}

/** Add these trades to the asks (a trade asked again counts from now). Their keys, in order. */
export async function addAskedTrades(
  trades: { spec: TradeSpec; top: boolean }[],
  now = Date.now(),
): Promise<string[]> {
  const asked = trades.map(({ spec, top }) => ({
    key: tradeKey(spec.partnerId, spec.give, spec.get),
    spec: specOf(spec),
    top,
    askedAt: new Date(now).toISOString(),
  }));
  const keys = new Set(asked.map((a) => a.key));
  const list = [...fresh(await stored(), now).filter((a) => !keys.has(a.key)), ...asked];
  await writeView(KEY, "", list, 0);
  return asked.map((a) => a.key);
}

/** Which asks still wait for a result: none settled at or after the ask. Pure. */
export function stillPending(
  list: AskedTrade[],
  settledAt: Map<string, Date>,
  now: number,
): AskedTrade[] {
  return fresh(list, now).filter((a) => {
    const at = settledAt.get(a.key);
    return !at || at.getTime() < Date.parse(a.askedAt);
  });
}

/** The asked trades a new job should check. */
export async function pendingAskedTrades(now = Date.now()): Promise<AskedTrade[]> {
  const list = fresh(await stored(), now);
  if (!list.length) return [];
  const rows = await db()<{ key: string; settled_at: Date }[]>`
    select key, settled_at from move_results where key = any(${list.map((a) => a.key)})
  `;
  return stillPending(list, new Map(rows.map((r) => [r.key, r.settled_at])), now);
}
