import "server-only";
// Expensive views kept in Postgres (view_cache): a page reads the stored result in one query
// instead of recomputing it. Each row carries a fingerprint of its inputs; the caller decides
// what to do when the inputs have moved on (lib/nba/trade-view.ts serves it while refreshing).

import { createHash } from "node:crypto";
import { db } from "./db";

export interface StoredView<T> {
  fingerprint: string;
  value: T;
  computedAt: Date;
}

/** A short, stable hash of any JSON-serializable input description. */
export function fingerprintOf(inputs: unknown): string {
  return createHash("sha1").update(JSON.stringify(inputs)).digest("base64url").slice(0, 22);
}

export async function readView<T>(key: string): Promise<StoredView<T> | null> {
  const rows = await db()<{ fingerprint: string; value: T; computed_at: Date }[]>`
    select fingerprint, value, computed_at from view_cache where key = ${key}
  `;
  const r = rows[0];
  return r ? { fingerprint: r.fingerprint, value: r.value, computedAt: r.computed_at } : null;
}

export async function writeView(key: string, fingerprint: string, value: unknown, ms: number) {
  await db()`
    insert into view_cache (key, fingerprint, value, computed_at, compute_ms)
    values (${key}, ${fingerprint}, ${db().json(value as never)}, now(), ${Math.round(ms)})
    on conflict (key) do update set fingerprint = excluded.fingerprint, value = excluded.value,
      computed_at = excluded.computed_at, compute_ms = excluded.compute_ms
  `;
}
