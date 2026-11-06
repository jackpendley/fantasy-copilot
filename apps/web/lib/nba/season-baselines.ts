import "server-only";
// Prior seasons' totals for Trends' "Vs last season" (lib/nba/vs-last-season.ts): ESPN's public
// season pool for the last two seasons, fetched once and kept in view_cache (past seasons don't
// change; the pool is ~26 MB per season, so never per page view).

import { fetchSeasonPool } from "@fantasy-copilot/espn";
import { dbConfigured } from "@/lib/db";
import { readView, writeView } from "@/lib/view-cache";
import { parseSeasonTotals, type SeasonLine } from "./vs-last-season";

const KEY = "season-baselines";
// "all": the whole pool (the first stored seasons were capped at 700 players, missing a third).
const fingerprintFor = (seasons: number[]) => `all|seasons:${seasons.join(",")}`;

/** The seasons a player can be compared with: the last two, newest first. */
export const priorSeasons = (current: number) => [current - 1, current - 2];

type Stored = Record<string, SeasonLine[]>;

/** Fetch and store the prior seasons unless they're already stored. True when it fetched. */
export async function refreshSeasonBaselines(current: number): Promise<boolean> {
  const seasons = priorSeasons(current);
  const row = await readView<Stored>(KEY).catch(() => null);
  if (row?.fingerprint === fingerprintFor(seasons)) return false;
  const t0 = performance.now();
  const value: Stored = {};
  for (const season of seasons)
    value[season] = parseSeasonTotals(await fetchSeasonPool(season), season);
  await writeView(KEY, fingerprintFor(seasons), value, performance.now() - t0);
  return true;
}

/** The stored prior seasons, newest first (empty until the nightly job has stored them). */
export async function seasonBaselines(
  current: number,
): Promise<{ season: number; lines: Map<number, SeasonLine> }[]> {
  if (!dbConfigured()) return [];
  const row = await readView<Stored>(KEY).catch(() => null);
  if (!row) return [];
  return priorSeasons(current)
    .filter((s) => row.value[s])
    .map((season) => ({ season, lines: new Map(row.value[season]!.map((l) => [l.id, l])) }));
}
