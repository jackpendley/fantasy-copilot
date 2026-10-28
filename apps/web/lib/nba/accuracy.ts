import "server-only";
// How accurate each projection source has been, game by game, and the props blend weight.
// Every pregame snapshot logs our projection, ESPN's and Vegas' (where posted); the next
// morning's box scores score them. The blend ships only through the pre-registered test
// (lib/nba/props-eval.ts) and is refit every night.

import { db, dbConfigured } from "@/lib/db";
import { evaluateProps, type EvalRow, type PropsEvaluation } from "./props-eval";

export interface ScoredGame {
  playerId: number;
  day: string;
  ours: number | null;
  vegas: number | null;
  espn: number | null;
  actual: number;
}

/** Every logged pregame projection with its result (games actually played). */
export async function scoredGames(): Promise<ScoredGame[]> {
  const rows = await db()<
    {
      player_id: number;
      day: string;
      model_fppg: number | null;
      vegas_fppg: number | null;
      espn_fppg: number | null;
      fp: number;
    }[]
  >`
    select p.player_id, to_char(p.tip at time zone 'America/New_York', 'YYYY-MM-DD') as day,
      p.model_fppg, p.vegas_fppg, p.espn_fppg, r.fp
    from pregame_projections p
    join game_results r using (game_id, player_id)
    where p.snapshot = 'pregame'
  `;
  return rows.map((r) => ({
    playerId: r.player_id,
    day: r.day,
    ours: r.model_fppg,
    vegas: r.vegas_fppg,
    espn: r.espn_fppg,
    actual: r.fp,
  }));
}

/** Rows for the props test: games with both our projection and Vegas'. */
export const evalRows = (games: ScoredGame[]): EvalRow[] =>
  games
    .filter((g) => g.ours != null && g.vegas != null)
    .map((g) => ({
      playerId: g.playerId,
      day: g.day,
      model: g.ours!,
      vegas: g.vegas!,
      actual: g.actual,
    }));

export interface BlendSetting {
  /** Weight on Vegas for games with props (0 until the test passes). */
  weight: number;
  ships: boolean;
  evaluatedAt: string;
  evaluation: PropsEvaluation | null;
  collected: { games: number; days: number };
}

let cached: { at: number; value: BlendSetting | null } | null = null;
const CACHE_MS = 30 * 60_000;

/** The current blend setting (cached for 30 minutes; none without a database). */
export async function blendSetting(): Promise<BlendSetting | null> {
  if (!dbConfigured()) return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const rows = await db()<{ value: BlendSetting }[]>`
    select value from model_settings where key = 'props_blend'
  `.catch(() => []);
  cached = { at: Date.now(), value: rows[0]?.value ?? null };
  return cached.value;
}

/** Nightly: re-run the pre-registered props test on everything logged and store the result. */
export async function refreshBlend(): Promise<BlendSetting> {
  const rows = evalRows(await scoredGames());
  const evaluation = evaluateProps(rows);
  const value: BlendSetting = {
    weight: evaluation?.ships ? evaluation.weight : 0,
    ships: evaluation?.ships ?? false,
    evaluatedAt: new Date().toISOString(),
    evaluation,
    collected: { games: rows.length, days: new Set(rows.map((r) => r.day)).size },
  };
  await db()`
    insert into model_settings (key, value) values ('props_blend', ${db().json(value as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  cached = { at: Date.now(), value };
  return value;
}

/** The projection to show and use: the blend for games with Vegas lines once it has shipped. */
export function bestProjection(ours: number, vegas: number | null, weight: number): number {
  return vegas != null && weight > 0 ? (1 - weight) * ours + weight * vegas : ours;
}

export interface SourceAccuracy {
  source: "ours" | "vegas" | "blend" | "espn";
  /** Average miss per game (mean absolute error), by window. */
  last7: { games: number; mae: number | null };
  last30: { games: number; mae: number | null };
  season: { games: number; mae: number | null };
}

/** Average miss per source; Vegas and the blend on games with props, ours and ESPN on all. */
export function accuracyBySource(
  games: ScoredGame[],
  weight: number,
  today: string,
): SourceAccuracy[] {
  const daysAgo = (day: string) => (Date.parse(today) - Date.parse(day)) / 86_400_000;
  const pick: Record<SourceAccuracy["source"], (g: ScoredGame) => number | null> = {
    ours: (g) => g.ours,
    vegas: (g) => g.vegas,
    blend: (g) =>
      g.ours != null && g.vegas != null ? bestProjection(g.ours, g.vegas, weight) : null,
    espn: (g) => g.espn,
  };
  const window = (src: (g: ScoredGame) => number | null, maxDays: number) => {
    const errs = games
      .filter((g) => daysAgo(g.day) <= maxDays)
      .map((g) => {
        const p = src(g);
        return p == null ? null : Math.abs(p - g.actual);
      })
      .filter((e): e is number => e != null);
    return {
      games: errs.length,
      mae: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    };
  };
  return (Object.keys(pick) as SourceAccuracy["source"][])
    .filter((s) => s !== "blend" || weight > 0)
    .map((source) => ({
      source,
      last7: window(pick[source], 7),
      last30: window(pick[source], 30),
      season: window(pick[source], Infinity),
    }));
}

let accuracyCache: { at: number; value: SourceAccuracy[] } | null = null;

/** accuracyBySource over everything logged, cached for 30 minutes (empty without a database). */
export async function currentAccuracy(today: string): Promise<SourceAccuracy[]> {
  if (!dbConfigured()) return [];
  if (accuracyCache && Date.now() - accuracyCache.at < CACHE_MS) return accuracyCache.value;
  const [games, blend] = await Promise.all([scoredGames(), blendSetting()]);
  const value = accuracyBySource(games, blend?.weight ?? 0, today);
  accuracyCache = { at: Date.now(), value };
  return value;
}
