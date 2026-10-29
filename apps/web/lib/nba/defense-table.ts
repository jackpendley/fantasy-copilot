import "server-only";
// Reading the opponent-defense factors (built nightly by lib/nba/defense.ts). Kept apart so
// the league loader can read them without importing what builds them.

import { db, dbConfigured } from "@/lib/db";
import type { DefenseTable } from "./projection";

export const DEFENSE_KEY = "defense_by_position";

export interface DefenseSetting {
  asOf: string;
  /** `${opponentProTeamId}|${position}` -> factor. */
  factors: DefenseTable;
  /** Player-games behind each factor. */
  games: Record<string, number>;
}

let cached: { at: number; value: DefenseTable | null } | null = null;
const CACHE_MS = 30 * 60_000;

/** The stored factors (null without a database or before the first nightly run). */
export async function defenseTable(): Promise<DefenseTable | null> {
  if (!dbConfigured()) return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const rows = await db()<{ value: DefenseSetting }[]>`
    select value from model_settings where key = ${DEFENSE_KEY}
  `.catch(() => []);
  cached = { at: Date.now(), value: rows[0]?.value.factors ?? null };
  return cached.value;
}

export function forgetDefenseTable() {
  cached = null;
}
