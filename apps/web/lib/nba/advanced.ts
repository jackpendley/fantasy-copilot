import "server-only";
// Advanced numbers for the player card's season tab, from free public sources:
//  - ESPN's stats API: PER, true shooting, effective FG%, assist and turnover ratios, +/-.
//  - PBP Stats (api.pbpstats.com, free, no key; credited on the card): usage, shot quality,
//    and where his shots come from (rim, mid-range, corner and above-the-break threes) with
//    accuracy. The league-wide pull takes seconds, so the nightly job stores it (pbp_players)
//    and the card reads one row.
//  - DARKO (darko.app): its daily projection (minutes and per-100 box score), scored with
//    this league's settings.
// PBP Stats and DARKO use NBA.com ids, so players are matched by name (team breaks ties).

import { fantasyPoints, withDerived, type ScoringMap } from "@fantasy-copilot/fantasy-core";
import { darkoPerGame, parseDarko } from "@fantasy-copilot/nba-data";
import { db, dbConfigured } from "@/lib/db";
import { memoFetch } from "@/lib/fetch-memo";

const SLOW = memoFetch(6 * 3600_000);

/** "Ja'Kobe Walter Jr." and "Jakobe Walter" both become "jakobe walter". */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** The entry for this player: same name, preferring his team when two share it. */
function byName<T>(rows: T[], name: string, team: string, get: (r: T) => [string, string]) {
  const key = nameKey(name);
  const same = rows.filter((r) => nameKey(get(r)[0]) === key);
  return same.find((r) => get(r)[1].toUpperCase() === team.toUpperCase()) ?? same[0] ?? null;
}

/** "2026-27" for ESPN season 2027. */
const seasonLabel = (season: number) => `${season - 1}-${String(season).slice(2)}`;

export interface EspnAdvanced {
  games: number;
  minutes: number;
  per: number | null;
  tsPct: number | null;
  efgPct: number | null;
  astRatio: number | null;
  toRatio: number | null;
  plusMinus: number | null;
}

/** ESPN's season stats for one player (regular season), or null before his first game. */
export async function espnAdvanced(id: number, season: number): Promise<EspnAdvanced | null> {
  const url = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${season}/types/2/athletes/${id}/statistics`;
  const res = await SLOW(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    splits?: { categories?: { stats: { name: string; value: number }[] }[] };
  };
  const stat = new Map(
    (data.splits?.categories ?? []).flatMap((c) => c.stats.map((s) => [s.name, s.value])),
  );
  const games = stat.get("gamesPlayed") ?? 0;
  if (!games) return null;
  // ESPN leaves stats it doesn't compute at 0; those show as missing.
  const val = (k: string) => (stat.get(k) ? stat.get(k)! : null);
  return {
    games,
    minutes: stat.get("avgMinutes") ?? 0,
    per: val("PER"),
    tsPct: val("trueShootingPct"),
    efgPct: val("effectiveFGPct"),
    astRatio: val("assistRatio"),
    toRatio: val("turnoverRatio"),
    plusMinus: stat.has("plusMinus") ? stat.get("plusMinus")! : null,
  };
}

export interface ShotZone {
  zone: string;
  /** Share of his shots from here, and how often they go in. */
  frequency: number;
  accuracy: number | null;
}

export interface PbpPlayer {
  nbaId: number;
  usage: number | null;
  tsPct: number | null;
  /** PBP Stats' expected eFG% of his shots (where they're taken from and how). */
  shotQuality: number | null;
  zones: ShotZone[];
}

type PbpRow = Record<string, string | number | null>;

async function pbpTotals(season: number): Promise<PbpRow[]> {
  const url = `https://api.pbpstats.com/get-totals/nba?Season=${seasonLabel(season)}&SeasonType=Regular%2BSeason&Type=Player`;
  const res = await SLOW(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { multi_row_table_data?: PbpRow[] };
  return data.multi_row_table_data ?? [];
}

const ZONES: [string, string][] = [
  ["At rim", "AtRim"],
  ["Short mid", "ShortMidRange"],
  ["Long mid", "LongMidRange"],
  ["Corner 3", "Corner3"],
  ["Above-break 3", "Arc3"],
];

function pbpRow(r: PbpRow): PbpPlayer & { name: string; team: string } {
  const num = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : null);
  return {
    nbaId: Number(r.EntityId),
    name: String(r.Name ?? ""),
    team: String(r.TeamAbbreviation ?? ""),
    usage: num("Usage"),
    tsPct: num("TsPct"),
    shotQuality: num("ShotQualityAvg"),
    zones: ZONES.map(([zone, k]) => ({
      zone,
      frequency: num(`${k}Frequency`) ?? 0,
      accuracy: num(`${k}Accuracy`),
    })).filter((z) => z.frequency > 0),
  };
}

/** Nightly: store every player's PBP Stats season numbers. Returns players stored per season. */
export async function refreshPbpPlayers(seasons: number[]): Promise<Record<number, number>> {
  const out: Record<number, number> = {};
  for (const season of seasons) {
    const rows = (await pbpTotals(season)).map(pbpRow).filter((r) => r.nbaId > 0);
    if (!rows.length) continue;
    await db().begin(async (sql) => {
      await sql`delete from pbp_players where season = ${season}`;
      for (let i = 0; i < rows.length; i += 200) {
        await sql`insert into pbp_players ${sql(
          rows.slice(i, i + 200).map((r) => ({
            season,
            nba_id: r.nbaId,
            name_key: nameKey(r.name),
            team: r.team,
            usage: r.usage,
            ts_pct: r.tsPct,
            shot_quality: r.shotQuality,
            zones: sql.json(r.zones as never),
          })),
        )}`;
      }
    });
    out[season] = rows.length;
  }
  return out;
}

let filling: Promise<unknown> | null = null;

/** Before the first nightly run: fill the table once (in the background, one at a time). */
export async function ensurePbpPlayers(seasons: number[]) {
  if (!dbConfigured() || filling) return;
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int as n from pbp_players where season = ${seasons[0]!}
  `;
  if ((row?.n ?? 0) > 0) return;
  filling = refreshPbpPlayers(seasons).finally(() => {
    filling = null;
  });
  await filling;
}

/** His stored PBP Stats season (team breaks a name tie); null if not stored. */
export async function pbpPlayer(name: string, team: string, season: number) {
  if (!dbConfigured()) return null;
  const rows = await db()<
    {
      nba_id: number;
      team: string;
      usage: number | null;
      ts_pct: number | null;
      shot_quality: number | null;
      zones: ShotZone[];
    }[]
  >`
    select nba_id, team, usage, ts_pct, shot_quality, zones from pbp_players
    where season = ${season} and name_key = ${nameKey(name)}
  `;
  const r = rows.find((x) => x.team.toUpperCase() === team.toUpperCase()) ?? rows[0];
  if (!r) return null;
  return {
    nbaId: r.nba_id,
    usage: r.usage,
    tsPct: r.ts_pct,
    shotQuality: r.shot_quality,
    zones: r.zones,
  } satisfies PbpPlayer;
}

export interface DarkoView {
  asOf: string | null;
  minutes: number;
  /** DARKO's projection, scored with this league's settings. */
  fppg: number;
}

export async function darkoView(name: string, team: string, scoring: ScoringMap) {
  const res = await SLOW("https://www.darko.app/projections/__data.json");
  if (!res.ok) return null;
  const { asOf, players } = parseDarko(await res.json());
  const d = byName(players, name, team, (x) => [x.name, x.team]);
  if (!d) return null;
  return {
    asOf,
    minutes: d.minutes,
    fppg: fantasyPoints(withDerived(darkoPerGame(d)), scoring),
  } satisfies DarkoView;
}
