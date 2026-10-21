import "server-only";
// Scheduled jobs, called by /api/cron/[job]. Each logs one refresh_log row.

import { EspnError } from "@fantasy-copilot/espn";
import { db } from "./db";
import { fmtTip } from "./format";
import { sendAlertOnce } from "./push";
import { gamedayAlerts } from "./nba/alerts";
import { etDate, scoringPeriodForDate, LAST_SCORING_PERIOD } from "./nba/calendar";
import { loadLeague } from "./nba/data";
import { buildDayBoard } from "./nba/day";
import { rosterWatch } from "./nba/outlook-refresh";
import { statusEventsFrom } from "./nba/news";
import { recordMatchupSnapshot } from "./nba/matchup-snapshots";
import { runOutlook } from "./nba/outlook-run";

async function log(job: string, status: "ok" | "error", detail: string) {
  await db()`insert into refresh_log (job, status, detail) values (${job}, ${status}, ${detail})`;
}

/** Window around today's games when the 5-minute checks do real work. */
const BEFORE_FIRST_TIP_MS = 90 * 60_000;
const AFTER_LAST_TIP_MS = 15 * 60_000;

/**
 * Every 5 minutes: re-run the outlook if a roster move landed, then log status changes and
 * send any game-day alerts. Outside the window around today's games it returns without
 * touching the database unless a move is recent (Neon sleeps).
 */
export async function gamedayJob(now = new Date()): Promise<Record<string, unknown>> {
  const date = etDate(now);
  const sp = scoringPeriodForDate(date);
  if (sp < 1 || sp > LAST_SCORING_PERIOD) return { skipped: "outside the season" };

  // Any league roster move re-runs the season outlook within a few minutes, game day or not.
  const watch = await rosterWatch(now).catch(async (e: Error) => {
    await log("roster-watch", "error", e.message).catch(() => {});
    return { watch: "error" };
  });

  let data;
  try {
    data = await loadLeague(sp, date);
  } catch (e) {
    if (e instanceof EspnError && e.status === 401) {
      await sendAlertOnce(`sync-fail:${date}`, {
        title: "ESPN login expired",
        body: "The app can't read your league. Copy fresh espn_s2/SWID cookies into Vercel.",
        url: "/nba/today",
      });
    }
    await log("gameday", "error", (e as Error).message);
    throw e;
  }

  const games = data.games.filter((g) => g.scoringPeriodId === sp);
  if (!games.length) return { ...watch, skipped: "no games today" };
  const tips = games.map((g) => g.date);
  const t = now.getTime();
  if (t < Math.min(...tips) - BEFORE_FIRST_TIP_MS || t > Math.max(...tips) + AFTER_LAST_TIP_MS) {
    return { ...watch, skipped: "outside game window" };
  }

  const events = statusEventsFrom({
    rostered: data.teams.flatMap((team) => team.roster),
    injuries: data.injuries,
    lineups: data.lineups,
    gameDate: date,
  });
  let newEvents = 0;
  if (events.length) {
    const rows = events.map((e) => ({
      player_id: e.playerId,
      source: e.source,
      status: e.status,
      detail: e.detail,
      published_at: e.publishedAt,
      game_date: e.gameDate,
    }));
    const inserted = await db()`
      insert into status_events ${db()(rows, "player_id", "source", "status", "detail", "published_at", "game_date")}
      on conflict do nothing
      returning id
    `;
    newEvents = inserted.length;
  }

  const board = buildDayBoard({
    roster: data.me.roster,
    slotCounts: data.settings.slotCounts,
    games,
    scoreboard: data.scoreboard,
    injuries: data.injuries,
    lineups: data.lineups,
    now,
  });
  const alerts = gamedayAlerts(board, date, now, fmtTip);
  let sent = 0;
  for (const a of alerts) {
    if (await sendAlertOnce(a.key, { title: a.title, body: a.body, url: a.url })) sent++;
  }
  const result = { date, ...watch, events: events.length, newEvents, alerts: alerts.length, sent };
  await log("gameday", "ok", JSON.stringify(result));
  return result;
}

/** Once a day, before the games: re-run the season outlook with yesterday's results. */
export async function nightlyJob(): Promise<Record<string, unknown>> {
  try {
    // Before today's games: this week's win chance, for the matchup page's chart. A failure
    // here is logged but doesn't stop the season outlook.
    const matchup = await recordMatchupSnapshot().catch(async (e: Error) => {
      await log("matchup-snapshot", "error", e.message);
      return null;
    });
    const { scoringPeriod, teams } = await runOutlook();
    const me = teams.find((t) => t.teamId === Number(process.env.ESPN_TEAM_ID));
    const result = {
      scoringPeriod,
      title: me?.champ,
      playoffs: me?.playoffs,
      weekWin: matchup?.p_win,
    };
    await log("nightly", "ok", JSON.stringify(result));
    return result;
  } catch (e) {
    await log("nightly", "error", (e as Error).message);
    throw e;
  }
}
