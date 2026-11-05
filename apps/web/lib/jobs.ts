import "server-only";
// Scheduled jobs, called by /api/cron/[job]. Each logs one refresh_log row.

import { EspnError } from "@fantasy-copilot/espn";
import { fetchDarko } from "@fantasy-copilot/nba-data";
import { db } from "./db";
import { fmtTip } from "./format";
import { sendAlertOnce } from "./push";
import { gamedayAlerts } from "./nba/alerts";
import { scoringPeriodForDate, LAST_SCORING_PERIOD, gameDate } from "./nba/calendar";
import { loadFreeAgents, loadLeague } from "./nba/data";
import { refreshBlend } from "./nba/accuracy";
import { refreshPbpPlayers } from "./nba/advanced";
import { refreshDefense } from "./nba/defense";
import { buildDayBoard } from "./nba/day";
import { collectMarketData, recordResults, snapshotDarko, type Snapshot } from "./nba/market-data";
import { rosterWatch, workerEnabled } from "./nba/outlook-refresh";
import { statusEventsFrom, type StatusEvent } from "./nba/news";
import { logOfficialReport } from "./nba/official-report";
import {
  recordMatchupSnapshot,
  recordMatchupStates,
  recordTimeline,
} from "./nba/matchup-snapshots";
import { latestOutlook, runOutlook } from "./nba/outlook-run";
import { enqueueSimJob, pruneSimJobs } from "./nba/sim-jobs";
import { refreshMoveChecks } from "./nba/move-checks";
import { syncTransactions } from "./nba/move-history";
import { refreshTradeTargets } from "./nba/trade-view";

async function log(job: string, status: "ok" | "error", detail: string) {
  await db()`insert into refresh_log (job, status, detail) values (${job}, ${status}, ${detail})`;
}

/** An error's message plus its cause, which fetch hides ("fetch failed: ECONNRESET"). */
export function errorText(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const cause = err.cause?.code ?? err.cause?.message;
  return cause && !err.message.includes(cause) ? `${err.message}: ${cause}` : err.message;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One step of a scheduled job: its result (or "ok") or its error goes to refresh_log under
 * its own name, so Settings shows each step's latest state. A failure returns null and never
 * stops the job. `retries` are waits in ms before each retry.
 */
async function step<T>(
  job: string,
  run: () => Promise<T>,
  retries: number[] = [],
): Promise<T | null> {
  for (let i = 0; ; i++) {
    try {
      const out = await run();
      const detail = out == null || typeof out === "boolean" ? "ok" : JSON.stringify(out);
      await log(job, "ok", detail.slice(0, 2000)).catch(() => {});
      return out;
    } catch (e) {
      if (i < retries.length) {
        await sleep(retries[i]!);
        continue;
      }
      await log(job, "error", errorText(e)).catch(() => {});
      return null;
    }
  }
}

/** Window around today's games when the 5-minute checks do real work. */
const BEFORE_FIRST_TIP_MS = 90 * 60_000;
/** Games tipping within this window get their props captured as the closing line. */
const CLOSE_WINDOW_MS = 90 * 60_000;
const AFTER_LAST_TIP_MS = 15 * 60_000;
/** Games are surely over this long after the last tip. */
const TIMELINE_AFTER_MS = 3.5 * 3600_000;

/**
 * Every 5 minutes: re-run the outlook if a roster move landed, then log status changes and
 * send any game-day alerts. Outside the window around today's games it returns without
 * touching the database unless a move is recent (Neon sleeps).
 */
export async function gamedayJob(now = new Date()): Promise<Record<string, unknown>> {
  const date = gameDate(now);
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
    await log("gameday", "error", errorText(e));
    throw e;
  }

  // DARKO publishes once a day at no fixed time: look hourly, game day or not.
  const darko = await darkoCheck(now, data, sp).catch(async (e: Error) => {
    await log("darko", "error", errorText(e)).catch(() => {});
    return null;
  });

  const games = data.games.filter((g) => g.scoringPeriodId === sp);
  if (!games.length) return { ...watch, darko, skipped: "no games today" };
  const tips = games.map((g) => g.date);
  const t = now.getTime();

  // The Matchup chart's line through the day: every 15 minutes from the first tip until the
  // last game is surely over (3.5 hours after the last tip).
  const timeline =
    t >= Math.min(...tips) &&
    t <= Math.max(...tips) + TIMELINE_AFTER_MS &&
    now.getUTCMinutes() % 15 < 5
      ? await step("matchup-timeline", () => recordTimeline(data, sp))
      : null;

  // Today's win-chance point, if the nightly job couldn't record it (before the first tip only,
  // so it's still a pregame snapshot).
  if (t < Math.min(...tips) && etHour(now) >= 8) await snapshotIfMissing(sp, now);

  // Availability forward test (MODEL_CARD 2026-10-30): the official injury report and ESPN's
  // feed for every listed player, from 9 AM on game days (its midday snapshot comes long before
  // the game window opens).
  const availability =
    etHour(now) >= 9 && t <= Math.max(...tips) + AFTER_LAST_TIP_MS
      ? await logAvailabilitySources(data, date, now).catch(async (e: Error) => {
          await log("official-report", "error", e.message);
          return { error: e.message };
        })
      : null;

  const morningNews =
    availability && "rosteredNews" in availability ? availability.rosteredNews : 0;
  // New injury news changes trade values: refresh the stored trade ideas.
  const refreshTrades = () =>
    refreshTradeTargets().catch(async (e: Error) => {
      await log("trade-targets", "error", e.message);
      return null;
    });

  if (t < Math.min(...tips) - BEFORE_FIRST_TIP_MS || t > Math.max(...tips) + AFTER_LAST_TIP_MS) {
    const trades = morningNews ? await refreshTrades() : null;
    return {
      ...watch,
      darko,
      timeline,
      availability,
      tradesRefreshed: trades,
      skipped: "outside game window",
    };
  }

  const { events, newEvents } = await logStatusEvents(data, date);
  const trades = newEvents + morningNews ? await refreshTrades() : null;

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
    defense: data.defense,
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
    // A push failure is logged; it never stops the checks.
    const ok = await sendAlertOnce(a.key, { title: a.title, body: a.body, url: a.url }).catch(
      async (e: Error) => {
        await log("push", "error", errorText(e)).catch(() => {});
        return false;
      },
    );
    if (ok) sent++;
  }
  const result = {
    date,
    ...watch,
    darko,
    timeline,
    closingProps: market?.props ?? 0,
    tradesRefreshed: trades,
    events: events.length,
    newEvents,
    availability,
    alerts: alerts.length,
    sent,
  };
  await log("gameday", "ok", JSON.stringify(result));
  return result;
}

/** Once a day, before the games: re-run the season outlook with yesterday's results. */
export async function nightlyJob(): Promise<Record<string, unknown>> {
  try {
    // Before today's games: this week's win chance, for the matchup page's chart. Two retries
    // (a transient ESPN or network error would otherwise leave a day off the chart); the
    // 5-minute job tries again before the first tip if it's still missing.
    const matchup = await step("matchup-snapshot", () => recordMatchupSnapshot(), [20_000, 60_000]);
    // Every league matchup's state, for calibrating the weekly win probability.
    const states = await step("matchup-states", () => recordMatchupStates(), [20_000]);
    // The season simulations: on the GitHub Actions worker when it's set up (the Outlook and
    // deep move checks arrive within minutes), otherwise here.
    const queued = workerEnabled()
      ? await step("sim-job", () => enqueueSimJob(null).then((id) => ({ job: id })))
      : null;
    const { scoringPeriod, teams } = queued
      ? await latestOutlook().then((r) => ({
          scoringPeriod: r?.scoring_period ?? 0,
          teams: r?.results ?? [],
        }))
      : await runOutlook();
    // A new day's projections: have the trade ideas ready for the first visit.
    const trades = await step("trade-targets", () => refreshTradeTargets());
    const moves = queued ? null : await step("move-checks", () => refreshMoveChecks());
    // PBP Stats season numbers for the player cards (this season and last).
    const season = Number(process.env.ESPN_SEASON || 2027);
    const pbp = await step("pbp-players", () => refreshPbpPlayers([season, season - 1]));
    // Old simulation jobs (each holds its moves and chunks): the last two days are kept.
    const simJobsPruned = await step("sim-prune", () => pruneSimJobs());
    // The league's roster moves, for the team pages' move history (ADR-056).
    const transactions = await step("transactions", () =>
      syncTransactions(
        Math.min(Math.max(scoringPeriodForDate(gameDate()), 1), LAST_SCORING_PERIOD),
      ),
    );
    // Morning lines and the day's DARKO projections, for the model. Never fails the job.
    const market = await step("market-data", () => collectToday("morning", true));
    // Opponent defense by position from every result so far (after yesterday's box scores).
    const defense = await step("defense", () => refreshDefense());
    const me = teams.find((t) => t.teamId === Number(process.env.ESPN_TEAM_ID));
    const result = {
      scoringPeriod,
      title: me?.champ,
      playoffs: me?.playoffs,
      weekWin: matchup?.p_win,
      tradesRefreshed: trades,
      movesChecked: moves,
      pbpPlayers: pbp,
      simJobsPruned,
      transactions,
      defense,
      ...states,
      ...market,
    };
    await log("nightly", "ok", JSON.stringify(result));
    return result;
  } catch (e) {
    await log("nightly", "error", errorText(e));
    throw e;
  }
}

/** Capture today's props and game lines (and, with `darko`, a DARKO snapshot). */
async function collectToday(snapshot: Snapshot, darko = false): Promise<Record<string, unknown>> {
  const date = gameDate();
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
      ? await refreshBlend(data.settings.scoring, date)
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

/** Scoring periods whose win-chance snapshot is known to exist (per server instance). */
const snapshotted = new Set<number>();

async function snapshotIfMissing(sp: number, now: Date) {
  if (snapshotted.has(sp)) return;
  const [row] = await db()`select 1 from matchup_snapshots where scoring_period = ${sp} limit 1`;
  if (!row) await step("matchup-snapshot", () => recordMatchupSnapshot(now));
  snapshotted.add(sp);
}

/** DARKO's latest as-of date seen by this server instance (saves a database check). */
let darkoSeen: string | null = null;

/** Once an hour from 6 AM ET: snapshot DARKO's projections when it has published a new run. */
async function darkoCheck(now: Date, data: Awaited<ReturnType<typeof loadLeague>>, sp: number) {
  if (now.getUTCMinutes() >= 5 || etHour(now) < 6) return null;
  const fetched = await fetchDarko();
  if (!fetched.asOf || fetched.asOf === darkoSeen) return null;
  const free = await loadFreeAgents(sp).catch(() => []);
  const players = [...data.ahead.teams.flatMap((t) => t.roster), ...free.map((f) => f.player)];
  const out = await snapshotDarko(players, fetched);
  darkoSeen = fetched.asOf;
  if ("matched" in out) await log("darko", "ok", JSON.stringify(out));
  return out.darko;
}

/** Early evening, before most tips: the pregame snapshot of props and game lines. */
export async function pregameJob(): Promise<Record<string, unknown>> {
  try {
    const result = await collectToday("pregame");
    await log("pregame", "ok", JSON.stringify(result));
    return result;
  } catch (e) {
    await log("pregame", "error", errorText(e));
    throw e;
  }
}

/** Hour of the day in US/Eastern. */
const etHour = (at: Date) =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      hour: "2-digit",
    }).format(at),
  );

/** The availability test's inputs: ESPN's whole injury feed and the latest official report. */
async function logAvailabilitySources(
  data: Awaited<ReturnType<typeof loadLeague>>,
  date: string,
  now: Date,
) {
  const rostered = data.teams.flatMap((team) => team.roster);
  const fresh = await insertStatusEvents(
    statusEventsFrom({
      rostered: [],
      injuries: data.injuries,
      lineups: null,
      gameDate: date,
      everyInjury: true,
    }),
  );
  const ids = new Set(rostered.map((p) => p.id));
  const official = await logOfficialReport({
    now,
    rostered,
    injuries: data.injuries,
    games: data.games,
  });
  return {
    ...official,
    espnEvents: fresh.length,
    /** New injury news for rostered players (it moves trade values). */
    rosteredNews: fresh.filter((id) => ids.has(id)).length,
  };
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
  return { events, newEvents: (await insertStatusEvents(events)).length };
}

/**
 * Insert status events (a status is stored once per source and game day until it changes); the
 * players with a new one.
 */
async function insertStatusEvents(events: StatusEvent[]): Promise<number[]> {
  if (!events.length) return [];
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
    returning player_id
  `;
  return inserted.map((r) => r.player_id as number);
}
