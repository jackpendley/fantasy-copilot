import "server-only";
// Scheduled jobs, called by /api/cron/[job]. Each logs one refresh_log row.

import { EspnError } from "@fantasy-copilot/espn";
import { db } from "./db";
import { fmtTip } from "./format";
import { sendAlertOnce } from "./push";
import { gamedayAlerts } from "./nba/alerts";
import { etDate, scoringPeriodForDate, LAST_SCORING_PERIOD } from "./nba/calendar";
import { loadFreeAgents, loadLeague } from "./nba/data";
import { refreshBlend } from "./nba/accuracy";
import { buildDayBoard } from "./nba/day";
import { collectMarketData, recordResults, snapshotDarko, type Snapshot } from "./nba/market-data";
import { rosterWatch } from "./nba/outlook-refresh";
import { statusEventsFrom, type StatusEvent } from "./nba/news";
import { recordMatchupSnapshot, recordMatchupStates } from "./nba/matchup-snapshots";
import { runOutlook } from "./nba/outlook-run";
import { refreshTradeTargets } from "./nba/trade-view";

async function log(job: string, status: "ok" | "error", detail: string) {
  await db()`insert into refresh_log (job, status, detail) values (${job}, ${status}, ${detail})`;
}

/** Window around today's games when the 5-minute checks do real work. */
const BEFORE_FIRST_TIP_MS = 90 * 60_000;
/** Games tipping within this window get their props captured as the closing line. */
const CLOSE_WINDOW_MS = 90 * 60_000;
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

  const { events, newEvents } = await logStatusEvents(data, date);
  // New injury news changes trade values: refresh the stored trade ideas.
  const trades = newEvents
    ? await refreshTradeTargets().catch(async (e: Error) => {
        await log("trade-targets", "error", e.message);
        return null;
      })
    : null;

  // Closing lines: re-captured every 5 minutes until tip for games starting soon.
  const closing = games.filter((g) => g.date > t && g.date - t <= CLOSE_WINDOW_MS);
  const market = closing.length
    ? await collectMarketData(closing, date.replace(/-/g, ""), "close", now, {
        players: new Map(data.ahead.teams.flatMap((t) => t.roster).map((p) => [p.id, p])),
        scoring: data.settings.scoring,
        sp,
      }).catch(async (e) => {
        await log("market-data", "error", (e as Error).message);
        return null;
      })
    : null;

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
  const result = {
    date,
    ...watch,
    closingProps: market?.props ?? 0,
    tradesRefreshed: trades,
    events: events.length,
    newEvents,
    alerts: alerts.length,
    sent,
  };
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
    // Every league matchup's state, for calibrating the weekly win probability.
    const states = await recordMatchupStates().catch(async (e: Error) => {
      await log("matchup-states", "error", e.message);
      return null;
    });
    const { scoringPeriod, teams } = await runOutlook();
    // A new day's projections: have the trade ideas ready for the first visit.
    const trades = await refreshTradeTargets().catch(async (e: Error) => {
      await log("trade-targets", "error", e.message);
      return null;
    });
    // Morning lines and the day's DARKO projections, for the model. Never fails the job.
    const market = await collectToday("morning", true).catch(async (e: Error) => {
      await log("market-data", "error", e.message);
      return null;
    });
    const me = teams.find((t) => t.teamId === Number(process.env.ESPN_TEAM_ID));
    const result = {
      scoringPeriod,
      title: me?.champ,
      playoffs: me?.playoffs,
      weekWin: matchup?.p_win,
      tradesRefreshed: trades,
      ...states,
      ...market,
    };
    await log("nightly", "ok", JSON.stringify(result));
    return result;
  } catch (e) {
    await log("nightly", "error", (e as Error).message);
    throw e;
  }
}

/** Capture today's props and game lines (and, with `darko`, a DARKO snapshot). */
async function collectToday(snapshot: Snapshot, darko = false): Promise<Record<string, unknown>> {
  const date = etDate();
  const sp = scoringPeriodForDate(date);
  if (sp < 1 || sp > LAST_SCORING_PERIOD) return { skipped: "outside the season" };
  const data = await loadLeague(sp, date);
  const games = data.games.filter((g) => g.scoringPeriodId === sp);
  const free = await loadFreeAgents(sp).catch(() => []);
  const players = [...data.ahead.teams.flatMap((t) => t.roster), ...free.map((f) => f.player)];
  const lines = await collectMarketData(games, date.replace(/-/g, ""), snapshot, new Date(), {
    players: new Map(players.map((p) => [p.id, p])),
    scoring: data.settings.scoring,
    sp,
  });
  const snap = darko ? await snapshotDarko(players) : {};
  // Injury statuses and estimated returns, twice a day even without the 5-minute job.
  const status = await logStatusEvents(data, date);
  // Yesterday's box scores, to score those projections against.
  const results =
    snapshot === "morning" && sp > 1
      ? await recordResults(
          data.games.filter((g) => g.scoringPeriodId === sp - 1),
          data.settings.scoring,
        )
      : {};
  // Then re-run the pre-registered props test; the blend weight only moves if it passes.
  const blend =
    snapshot === "morning"
      ? await refreshBlend()
          .then((b) => ({
            blendWeight: b.weight,
            blendShips: b.ships,
            blendGames: b.collected.games,
          }))
          .catch(() => ({}))
      : {};
  return {
    [`${snapshot}Props`]: lines.props,
    gamesWithLines: lines.games,
    newStatusEvents: status.newEvents,
    ...snap,
    ...results,
    ...blend,
  };
}

/** Early evening, before most tips: the pregame snapshot of props and game lines. */
export async function pregameJob(): Promise<Record<string, unknown>> {
  try {
    const result = await collectToday("pregame");
    await log("pregame", "ok", JSON.stringify(result));
    return result;
  } catch (e) {
    await log("pregame", "error", (e as Error).message);
    throw e;
  }
}

/** Record status changes (injury feed, NBA.com lineups, ESPN fantasy) for every rostered player. */
async function logStatusEvents(
  data: Awaited<ReturnType<typeof loadLeague>>,
  date: string,
): Promise<{ events: StatusEvent[]; newEvents: number }> {
  const events = statusEventsFrom({
    rostered: data.teams.flatMap((team) => team.roster),
    injuries: data.injuries,
    lineups: data.lineups,
    gameDate: date,
  });
  if (!events.length) return { events, newEvents: 0 };
  const rows = events.map((e) => ({
    player_id: e.playerId,
    source: e.source,
    status: e.status,
    detail: e.detail,
    published_at: e.publishedAt,
    game_date: e.gameDate,
    return_date: e.returnDate ?? null,
  }));
  const inserted = await db()`
    insert into status_events ${db()(
      rows,
      "player_id",
      "source",
      "status",
      "detail",
      "published_at",
      "game_date",
      "return_date",
    )}
    on conflict do nothing
    returning id
  `;
  return { events, newEvents: inserted.length };
}
