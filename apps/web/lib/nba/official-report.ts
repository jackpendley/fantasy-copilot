import "server-only";
// The league's official injury report, read live for the availability forward test (MODEL_CARD,
// 2026-10-30). Each 5-minute run on a game day checks for the report published in the current
// quarter hour (one request), and logs every status change for players it can match to ESPN.
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
 * Read this quarter hour's report if it's out and not read yet; log changed statuses. At most
 * one request per run (the league's CDN refuses bursts).
 */
export async function logOfficialReport(input: {
  now: Date;
  rostered: RosterPlayer[];
  injuries: InjuryReport[];
  games: ProGame[];
}): Promise<{ file: string; read: boolean; changes: number }> {
  const file = slotFile(input.now);
  const [last] = await db()<{ value: { file: string } }[]>`
    select value from model_settings where key = 'official_report_last'
  `;
  if (last?.value.file === file) return { file, read: false, changes: 0 };
  const report = await fetchInjuryReport(file);
  if (!report) return { file, read: false, changes: 0 };

  const rows = officialStatusRows(report, matchPool(input.rostered, input.injuries), input.games);
  let changes = 0;
  if (rows.length) {
    // Latest logged status per player and game day; only changes are stored.
    const latest = await db()<{ player_id: number; game_date: string; status: string }[]>`
      select distinct on (player_id, game_date) player_id, to_char(game_date, 'YYYY-MM-DD') as game_date, status
      from official_status
      where player_id in ${db()(rows.map((r) => r.playerId))}
        and game_date in ${db()([...new Set(rows.map((r) => r.gameDate))])}
      order by player_id, game_date, published_at desc
    `;
    const prev = new Map(latest.map((l) => [`${l.player_id}|${l.game_date}`, l.status]));
    const fresh = rows.filter((r) => prev.get(`${r.playerId}|${r.gameDate}`) !== r.status);
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
    changes = fresh.length;
  }
  await db()`
    insert into model_settings (key, value)
    values ('official_report_last', ${db().json({ file, publishedAt: report.publishedAt } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  return { file, read: true, changes };
}
