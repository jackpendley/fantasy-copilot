import "server-only";
// The league's official injury report, read live for the availability forward test (MODEL_CARD,
// 2026-10-30). Each 5-minute run on a game day checks for the report published in the current
// quarter hour (one request), and logs every status change for players it can match to ESPN
// (stored every 30 minutes, with each report's time).
// Nothing reads these chances yet: the test decides whether the app should.

import { PRO_TEAM_BY_ID, type ProGame, type RosterPlayer } from "@fantasy-copilot/espn";
import {
  buildMatcher,
  fetchInjuryReport,
  injuryReportFiles,
  toEspnTeam,
  type InjuryReport,
  type OfficialInjuryReport,
  type OfficialStatus,
} from "@fantasy-copilot/nba-data";
import { db } from "@/lib/db";
import { etDate } from "./calendar";

export interface OfficialStatusRow {
  playerId: number;
  gameId: number | null;
  gameDate: string;
  tip: string | null;
  status: OfficialStatus;
  reason: string;
  publishedAt: string;
}

/** A report's entries matched to ESPN players (rostered, or on ESPN's injury feed) and games. Pure. */
export function officialStatusRows(
  report: OfficialInjuryReport,
  players: { id: number; name: string; team: string }[],
  games: ProGame[],
): OfficialStatusRow[] {
  const match = buildMatcher(players);
  const teamId = new Map(Object.entries(PRO_TEAM_BY_ID).map(([id, abbr]) => [abbr, Number(id)]));
  const out: OfficialStatusRow[] = [];
  for (const e of report.entries) {
    const team = toEspnTeam(e.teamAbbr);
    const id = match(e.name, team);
    if (id == null) continue;
    const pro = teamId.get(team);
    const game = games.find(
      (g) =>
        (g.homeProTeamId === pro || g.awayProTeamId === pro) &&
        etDate(new Date(g.date)) === e.gameDate,
    );
    out.push({
      playerId: id,
      gameId: game?.gameId ?? null,
      gameDate: e.gameDate,
      tip: game ? new Date(game.date).toISOString() : null,
      status: e.status,
      reason: e.reason,
      publishedAt: report.publishedAt,
    });
  }
  return out;
}

/** The players a report can be matched against: rostered, plus everyone on ESPN's injury feed. */
export function matchPool(rostered: RosterPlayer[], injuries: InjuryReport[]) {
  const pool = rostered.map((p) => ({ id: p.id, name: p.name, team: p.proTeam }));
  const seen = new Set(pool.map((p) => p.id));
  for (const i of injuries)
    if (!seen.has(i.playerId) && i.teamId) {
      seen.add(i.playerId);
      pool.push({ id: i.playerId, name: i.name, team: PRO_TEAM_BY_ID[i.teamId] ?? "" });
    }
  return pool;
}

/** The quarter-hour report file for an instant (ET). */
function slotFile(at: Date): string {
  const [h, m] = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(at)
    .split(":")
    .map(Number);
  return injuryReportFiles(etDate(at), h!, Math.floor(m! / 15) * 15)[0]!;
}

/**
 * Read this quarter hour's report if it's out and not read yet, and hold its changed statuses
 * (with the report's time) for `storeOfficialReports`: the 5-minute job stores what it holds
 * every 30 minutes, so Neon sleeps between (docs/COMPUTE.md §10). At most one request per run
 * (the league's CDN refuses bursts).
 */
export async function logOfficialReport(input: {
  now: Date;
  rostered: RosterPlayer[];
  injuries: InjuryReport[];
  games: ProGame[];
}): Promise<{ file: string; read: boolean; held: number }> {
  const file = slotFile(input.now);
  if (memo.file === file) return { file, read: false, held: memo.held.length };
  const report = await fetchInjuryReport(file);
  if (!report) return { file, read: false, held: memo.held.length };

  const rows = officialStatusRows(report, matchPool(input.rostered, input.injuries), input.games);
  // Statuses this instance already holds or stored need no row. A new instance holds every
  // row; the store compares them with the table (another instance may have logged them).
  const changed = rows.filter((r) => memo.status.get(statusKey(r)) !== r.status);
  if (memo.status.size > 20_000) memo.status.clear();
  for (const r of changed) memo.status.set(statusKey(r), r.status);
  memo.held.push(...changed);
  memo.file = file;
  memo.publishedAt = report.publishedAt;
  return { file, read: true, held: memo.held.length };
}

/** Whether this instance holds statuses not stored yet. */
export const officialHeld = () => memo.held.length > 0;

/**
 * Store the held statuses that change the latest logged one for that player and game day, in
 * the order the reports came. Returns how many rows it stored.
 */
export async function storeOfficialReports(): Promise<number> {
  const held = memo.held.slice();
  if (!held.length) return 0;
  const latest = await db()<{ player_id: number; game_date: string; status: string }[]>`
    select distinct on (player_id, game_date) player_id, to_char(game_date, 'YYYY-MM-DD') as game_date, status
    from official_status
    where player_id in ${db()([...new Set(held.map((r) => r.playerId))])}
      and game_date in ${db()([...new Set(held.map((r) => r.gameDate))])}
    order by player_id, game_date, published_at desc
  `;
  const fresh = statusChanges(held, latest);
  if (fresh.length) {
    await db()`
      insert into official_status ${db()(
        fresh.map((r) => ({
          player_id: r.playerId,
          game_id: r.gameId,
          game_date: r.gameDate,
          tip: r.tip,
          status: r.status,
          reason: r.reason || null,
          published_at: r.publishedAt,
        })),
      )}
    `;
  }
  await db()`
    insert into model_settings (key, value)
    values ('official_report_last', ${db().json({ file: memo.file, publishedAt: memo.publishedAt } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  memo.held.splice(0, held.length);
  return fresh.length;
}

/**
 * Held rows (oldest first) that change a player's status for that game day, starting from the
 * latest logged ones. Pure.
 */
export function statusChanges(
  held: OfficialStatusRow[],
  latest: { player_id: number; game_date: string; status: string }[],
): OfficialStatusRow[] {
  const prev = new Map(latest.map((l) => [`${l.player_id}|${l.game_date}`, l.status]));
  return held.filter((r) => {
    if (prev.get(statusKey(r)) === r.status) return false;
    prev.set(statusKey(r), r.status);
    return true;
  });
}

const statusKey = (r: OfficialStatusRow) => `${r.playerId}|${r.gameDate}`;

/**
 * This server instance's last report read, each listed player's latest status by game day, and
 * the changes not stored yet.
 */
const memo = {
  file: null as string | null,
  publishedAt: null as string | null,
  status: new Map<string, string>(),
  held: [] as OfficialStatusRow[],
};
