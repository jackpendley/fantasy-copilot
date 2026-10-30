import "server-only";
// How accurate each projection source has been, game by game, and the props blend weight.
// Every pregame snapshot logs our projection, ESPN's and Vegas' (where posted); the next
// morning's box scores score them. The blend ships only through the pre-registered test
// (lib/nba/props-eval.ts) and is refit every night. DARKO's daily projection is scored the
// same way and runs the same test (MODEL_CARD candidate D), nightly, for the record.

import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import { db, dbConfigured } from "@/lib/db";
import { evaluateProps, type EvalRow, type PropsEvaluation } from "./props-eval";

export interface ScoredGame {
  playerId: number;
  day: string;
  ours: number | null;
  vegas: number | null;
  espn: number | null;
  /** DARKO's latest projection captured before tip (within 2 days), scored; null without scoring. */
  darko: number | null;
  actual: number;
}

/** Every logged pregame projection with its result (games actually played). */
export async function scoredGames(scoring?: ScoringMap): Promise<ScoredGame[]> {
  const rows = await db()<
    {
      player_id: number;
      day: string;
      model_fppg: number | null;
      vegas_fppg: number | null;
      espn_fppg: number | null;
      darko_line: Record<string, number> | null;
      fp: number;
    }[]
  >`
    select p.player_id, to_char(p.tip at time zone 'America/New_York', 'YYYY-MM-DD') as day,
      p.model_fppg, p.vegas_fppg, p.espn_fppg, r.fp,
      (select s.payload->'perGame' from projection_snapshots s
        where s.source = 'darko' and s.player_id = p.player_id and s.captured_at < p.tip
          and s.as_of >= (p.tip at time zone 'America/New_York')::date - 2
        order by s.as_of desc limit 1) as darko_line
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
    darko: scoring && r.darko_line ? fantasyPoints(withDerived(r.darko_line), scoring) : null,
    actual: r.fp,
  }));
}

/**
 * Rows for the props test: games with both our projection and Vegas'. The same test judges
 * DARKO (`other` = darko), whose number then sits in the rows' `vegas` slot.
 */
export const evalRows = (games: ScoredGame[], other: "vegas" | "darko" = "vegas"): EvalRow[] =>
  games
    .filter((g) => g.ours != null && g[other] != null)
    .map((g) => ({
      playerId: g.playerId,
      day: g.day,
      model: g.ours!,
      vegas: g[other]!,
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

export interface DarkoSetting {
  evaluatedAt: string;
  /** DARKO in the blend (candidate D); not wired into projections even if it passes. */
  evaluation: PropsEvaluation | null;
  collected: { games: number; days: number };
  accuracy: SourceAccuracy;
}

/** The latest DARKO check (cached with the accuracy table). */
export async function darkoSetting(): Promise<DarkoSetting | null> {
  if (!dbConfigured()) return null;
  const rows = await db()<{ value: DarkoSetting }[]>`
    select value from model_settings where key = 'darko_blend'
  `.catch(() => []);
  return rows[0]?.value ?? null;
}

/**
 * Nightly: re-run the pre-registered props test on everything logged and store the result;
 * with the league's scoring, the DARKO test and its accuracy too.
 */
export async function refreshBlend(scoring?: ScoringMap, today?: string): Promise<BlendSetting> {
  const games = await scoredGames(scoring);
  const rows = evalRows(games);
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
  if (scoring && today) {
    const darkoRows = evalRows(games, "darko");
    const darko: DarkoSetting = {
      evaluatedAt: value.evaluatedAt,
      evaluation: evaluateProps(darkoRows),
      collected: { games: darkoRows.length, days: new Set(darkoRows.map((r) => r.day)).size },
      accuracy: accuracyBySource(games, 0, today).find((a) => a.source === "darko")!,
    };
    await db()`
      insert into model_settings (key, value) values ('darko_blend', ${db().json(darko as never)})
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
  }
  return value;
}

/** The projection to show and use: the blend for games with Vegas lines once it has shipped. */
export function bestProjection(ours: number, vegas: number | null, weight: number): number {
  return vegas != null && weight > 0 ? (1 - weight) * ours + weight * vegas : ours;
}

export interface SourceAccuracy {
  source: "ours" | "vegas" | "blend" | "espn" | "darko";
  /** Average miss per game (mean absolute error), by window. */
  last7: { games: number; mae: number | null };
  last30: { games: number; mae: number | null };
  season: { games: number; mae: number | null };
}

/**
 * Average miss per source; Vegas and the blend on games with props, ours and ESPN on all,
 * DARKO on games with its projection.
 */
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
    darko: (g) => g.darko,
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
  return (
    (Object.keys(pick) as SourceAccuracy["source"][])
      .filter((s) => s !== "blend" || weight > 0)
      // DARKO is scored only in the nightly check (it needs the league's scoring).
      .filter((s) => s !== "darko" || games.some((g) => g.darko != null))
      .map((source) => ({
        source,
        last7: window(pick[source], 7),
        last30: window(pick[source], 30),
        season: window(pick[source], Infinity),
      }))
  );
}

let accuracyCache: { at: number; value: SourceAccuracy[] } | null = null;

/** accuracyBySource over everything logged, cached for 30 minutes (empty without a database). */
export async function currentAccuracy(today: string): Promise<SourceAccuracy[]> {
  if (!dbConfigured()) return [];
  if (accuracyCache && Date.now() - accuracyCache.at < CACHE_MS) return accuracyCache.value;
  const [games, blend, darko] = await Promise.all([scoredGames(), blendSetting(), darkoSetting()]);
  // DARKO is scored nightly (it needs the league's scoring), so its row comes from that check.
  const value = [
    ...accuracyBySource(games, blend?.weight ?? 0, today),
    ...(darko ? [darko.accuracy] : []),
  ];
  accuracyCache = { at: Date.now(), value };
  return value;
}
