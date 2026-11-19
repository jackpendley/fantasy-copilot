import "server-only";
// Scheduled jobs, called by /api/cron/[job]. Each logs one refresh_log row.

import { EspnError } from "@fantasy-copilot/espn";
import { fetchDarko } from "@fantasy-copilot/nba-data";
import { CpuMeter, recordCpu } from "./cpu";
import { minimalOn, saverOn } from "./cpu-saver";
import { db, dbUse } from "./db";
import { checkNeonUsage } from "./neon-usage";
import { alertOnFailure, pruneLogs } from "./job-alerts";
import { fmtTip } from "./format";
import { sendAlertOnce } from "./push";
import { gamedayAlerts } from "./nba/alerts";
import { scoringPeriodForDate, LAST_SCORING_PERIOD, gameDate } from "./nba/calendar";
import { loadFreeAgents, loadLeague, nbaSchedule } from "./nba/data";
import {
  AFTER_LAST_TIP_MS,
  BEFORE_FIRST_TIP_MS,
  TIMELINE_AFTER_MS,
  gamedayPlan,
} from "./nba/gameday-plan";
import { refreshBlend } from "./nba/accuracy";
import { refreshPbpPlayers } from "./nba/advanced";
import { refreshSeasonBaselines } from "./nba/season-baselines";
import { refreshDefense } from "./nba/defense";
import { buildDayBoard } from "./nba/day";
import { collectMarketData, recordFinished, snapshotDarko, type Snapshot } from "./nba/market-data";
import { holdLineups, lineupsHeld, storeLineups } from "./nba/lineup-log";
import { contextDue, refreshContext } from "./nba/context-run";
import { queueLockJob, rosterWatch, simRosterCheck, workerEnabled } from "./nba/outlook-refresh";
import { statusEventsFrom } from "./nba/news";
import { holdStatusEvents, statusHeld, storeStatusEvents } from "./nba/status-log";
import {
  logOfficialReport,
  officialHeld,
  officialOut,
  storeOfficialReports,
} from "./nba/official-report";
import {
  recordMatchupSnapshot,
  recordMatchupStates,
  recordTimeline,
  storeTimeline,
  timelineHeld,
} from "./nba/matchup-snapshots";
import { latestOutlook, runOutlook } from "./nba/outlook-run";
import { closeQuietJobs, enqueueSimJob, ensureWorker, pruneSimJobs } from "./nba/sim-jobs";
import { refreshMoveChecks, watchedFreeAgents } from "./nba/move-checks";
import { syncTransactions } from "./nba/move-history";
import { refreshTradeTargets } from "./nba/trade-view";
import { pruneTasks } from "./nba/worker-tasks";
import { fingerprintOf } from "./view-cache";
import { forgetResponses } from "./fetch-memo";
import { refreshTeammateReturns, teammateReturnsDue } from "./nba/teammate-return-run";
import { ADJUSTING } from "./nba/teammate-return";

async function log(job: string, status: "ok" | "error", detail: string) {
  await db()`insert into refresh_log (job, status, detail) values (${job}, ${status}, ${detail})`;
  // A failure Jack should hear about now (lib/job-alerts.ts); never stops the job.
  if (status === "error") await alertOnFailure(job, detail).catch(() => false);
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

/**
 * Games tipping within this window get their props captured as the closing line. Each capture
 * overwrites the last, so only the final one counts: 8 minutes is the last run before the tip
 * (runs come every 5), with slack for a late one. It was 90, then 20, and each extra capture
 * woke Neon for a row that was overwritten (docs/COMPUTE.md §10).
 */
const CLOSE_WINDOW_MS = 8 * 60_000;
/** The lock job is queued by the first gameday run within this long after the first tip. */
const LOCK_JOB_WINDOW_MS = 60 * 60_000;

/**
 * Every 5 minutes: re-run the outlook if a roster move landed, then log status changes and
 * send any game-day alerts. Outside the window around today's games it returns without
 * touching the database unless a move is recent (Neon sleeps).
 */
export async function gamedayJob(now = new Date()): Promise<Record<string, unknown>> {
  const m = new CpuMeter();
  const queries = dbUse.queries;
  let result: Record<string, unknown> = {};
  try {
    result = await gamedayRun(now, m);
    return result;
  } finally {
    // Work waiting with no runner (a missed dispatch) starts one, and a job whose runners went
    // quiet is closed, while the database is awake.
    if (dbUse.queries > queries) {
      await ensureWorker().catch(() => false);
      await closeQuietJobs().catch(() => null);
    }
    // A run that sent no query left Neon asleep (its compute bills by the minute awake): its
    // CPU joins the next stored row instead of waking it.
    const quiet = dbUse.queries === queries;
    await recordCpu(
      "gameday",
      m,
      { skipped: result.skipped ?? null, leagueChanged: result.leagueChanged ?? null },
      quiet,
    );
  }
}

/** The first tip whose lock job this instance already queued or found (no query again). */
let lockChecked: number | null = null;

/** The league's fingerprint at the last gameday run on this instance (did anything change?). */
let lastLeague: string | null = null;

async function gamedayRun(now: Date, m: CpuMeter): Promise<Record<string, unknown>> {
  const queries = dbUse.queries;
  const date = gameDate(now);
  const sp = scoringPeriodForDate(date);
  if (sp < 1 || sp > LAST_SCORING_PERIOD) return { skipped: "outside the season" };

  // Any league roster move re-runs the season outlook within a few minutes, game day or not.
  const watch = await m.step("watch", () =>
    rosterWatch(now).catch(async (e: Error) => {
      await log("roster-watch", "error", e.message).catch(() => {});
      return { watch: "error" };
    }),
  );

  // What's due this run, from the schedule (cached): most runs need no league at all.
  const schedule = await m.step("schedule", () =>
    nbaSchedule(Number(process.env.ESPN_SEASON || 2027)),
  );
  const plan = gamedayPlan({
    t: now.getTime(),
    minute: now.getUTCMinutes(),
    etHour: etHour(now),
    saver: saverOn(now.getTime()),
    minimal: minimalOn(now.getTime()),
    tips: schedule.filter((g) => g.scoringPeriodId === sp).map((g) => g.date),
    // Under the CPU saver, only a move that set off a run loads the league (not one waiting its
    // turn, or one already in the numbers).
    moveSeen: saverOn(now.getTime())
      ? watch.watch === "refreshing" || watch.watch === "queued"
      : watch.watch !== "quiet",
  });
  if (!plan.load) {
    if (plan.snapshot) await m.step("snapshot", () => snapshotIfMissing(sp, now));
    // Logs held by earlier runs (the timeline's last points after the games) are stored on time.
    const stored =
      plan.store && logsHeld() ? await m.step("store", () => storeHeldLogs(new Set())) : null;
    return { ...watch, stored, skipped: "nothing due" };
  }

  let data;
  try {
    data = await m.step("league", () => loadLeague(sp, date));
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
  // Rosters, slots and injury news: unchanged since this instance's last run means the work
  // below repeats on the same data (docs/COMPUTE.md measures how often). Jack's roster from
  // tomorrow too: the simulations use it, and a move or IR change after today's lock shows only
  // there.
  const fp = fingerprintOf([
    data.teams.map((t) => [t.id, t.roster.map((p) => [p.id, p.slot, p.injuryStatus])]),
    data.ahead.me.roster.map((p) => [p.id, p.slot, p.injuryStatus]),
    data.injuries.map((i) => [i.playerId, i.status, i.returnDate ?? null]),
  ]);
  const leagueChanged = lastLeague == null ? null : fp !== lastLeague;
  lastLeague = fp;

  // Jack's players' injury news or IR slots changed since the latest simulation job: re-check
  // his moves (only when the league changed, so unchanged runs don't touch the database).
  const simRoster =
    leagueChanged === false
      ? null
      : await m.step("sim-trigger", () =>
          simRosterCheck(
            data.ahead.me.roster,
            data.injuries,
            watchedFreeAgents(data.me.watchList, data.teams),
          ).catch(async (e: Error) => {
            await log("sim-trigger", "error", e.message).catch(() => {});
            return null;
          }),
        );
  // Waiting news (the saver's gap since the last job) is looked at again on the next run.
  if (simRoster === "waiting") lastLeague = null;

  const darko = await m.step("darko", () =>
    darkoCheck(now, data, sp).catch(async (e: Error) => {
      await log("darko", "error", errorText(e)).catch(() => {});
      return null;
    }),
  );

  // The nightly computes the teammate-return effects; a day without them (the first after a
  // deploy, or a failed nightly) gets them now, once per instance a day.
  const returns = (await teammateReturnsDue(date))
    ? await m.step("teammate-returns", () =>
        step("teammate-returns", () => refreshReturns(sp, data)),
      )
    : null;

  // The nightly computes the context; a day without it (the first after a deploy, or a failed
  // nightly) gets it now, once per instance a day.
  const context = (await contextDue(date))
    ? await m.step("context", () => step("context", () => contextStep(date, data)))
    : null;

  const games = data.games.filter((g) => g.scoringPeriodId === sp);
  if (!games.length)
    return {
      ...watch,
      leagueChanged,
      simRoster,
      darko,
      returns,
      context,
      skipped: "no games today",
    };
  const tips = games.map((g) => g.date);
  const t = now.getTime();
  // NBA.com's lineups for every player (active, inactive, starters) as they change before the
  // games, held until the next store: who was really out, late scratches included.
  const lineups = holdLineups(data.lineups, date, now);

  // The Matchup chart's line through the day: every 15 minutes (30 in minimal mode) from the
  // first tip until the last game is surely over (3.5 hours after the last tip). Held, with
  // its time, until the next store.
  const timeline =
    t >= Math.min(...tips) &&
    t <= Math.max(...tips) + TIMELINE_AFTER_MS &&
    now.getUTCMinutes() % (minimalOn(t) ? 30 : 15) < 5
      ? await m.step("timeline", () =>
          recordTimeline(data, sp, now).catch(async (e: Error) => {
            await log("matchup-timeline", "error", errorText(e)).catch(() => {});
            return null;
          }),
        )
      : null;

  // Tonight's finished games, recorded when the database is awake anyway (the half-hourly store,
  // or a run that queried): box scores and who played, the same night instead of next morning.
  const finished = games.filter(
    (g) =>
      !recordedGames.has(g.gameId) &&
      data.scoreboard.find((s) => s.gameId === g.gameId)?.state === "post",
  );
  const results =
    finished.length && (plan.store || dbUse.queries > queries)
      ? await m.step("results", () =>
          recordFinished(finished, data.settings.scoring)
            .then((r) => {
              // One ESPN doesn't call final yet is tried again at the next store.
              if (!r.left) for (const g of finished) recordedGames.add(g.gameId);
              return r;
            })
            .catch(async (e: Error) => {
              await log("results", "error", errorText(e)).catch(() => {});
              return null;
            }),
        )
      : null;

  // Today's win-chance point, if the nightly job couldn't record it (before the first tip only,
  // so it's still a pregame snapshot).
  if (plan.snapshot) await m.step("snapshot", () => snapshotIfMissing(sp, now));

  // Availability forward test (MODEL_CARD 2026-10-30): the official injury report and ESPN's
  // feed for every listed player, from 9 AM on game days (its midday snapshot comes long before
  // the game window opens): every 10 minutes before the window, every 5 in it (gamedayPlan).
  const availability = plan.availability
    ? await m.step("availability", () =>
        logAvailabilitySources(data, date, now).catch(async (e: Error) => {
          await log("official-report", "error", e.message);
          return { error: e.message };
        }),
      )
    : null;

  // Store what the runs held (on the hour and half hour, or now if this run woke the database
  // anyway). New injury news for a rostered player changes trade values: refresh the stored
  // trade ideas (in minimal mode they wait for the nightly run or Jack's own move).
  const storeHeld = async () => {
    if (!(plan.store || dbUse.queries > queries) || !logsHeld())
      return { stored: null, trades: null };
    const rostered = new Set(data.teams.flatMap((team) => team.roster.map((p) => p.id)));
    const stored = await m.step("store", () => storeHeldLogs(rostered));
    const trades =
      stored.rosteredNews && !minimalOn(t)
        ? await m.step("trades", () =>
            refreshTradeTargets().catch(async (e: Error) => {
              await log("trade-targets", "error", e.message);
              return null;
            }),
          )
        : null;
    return { stored, trades };
  };

  if (t < Math.min(...tips) - BEFORE_FIRST_TIP_MS || t > Math.max(...tips) + AFTER_LAST_TIP_MS) {
    const { stored, trades } = await storeHeld();
    return {
      ...watch,
      leagueChanged,
      simRoster,
      darko,
      returns,
      timeline,
      results,
      lineups,
      availability,
      stored,
      tradesRefreshed: trades,
      skipped: "outside game window",
    };
  }

  // The first tip locks rosters: from then on a move counts from tomorrow, so the deep checks
  // (built before it, from today) run again once.
  const first = Math.min(...tips);
  const lockJob =
    workerEnabled() &&
    data.settings.rosterLock === "FIRSTGAME_SCORINGPERIOD" &&
    t >= first &&
    t < first + LOCK_JOB_WINDOW_MS &&
    lockChecked !== first
      ? await m.step("lock-job", () =>
          queueLockJob(first)
            .then((r) => ((lockChecked = first), r))
            .catch(async (e: Error) => {
              await log("lock-job", "error", errorText(e)).catch(() => {});
              return null;
            }),
        )
      : null;

  const events = await m.step("status", async () =>
    holdStatusEvents(rosterStatuses(data, date), now),
  );

  // Closing lines: re-captured every 5 minutes until tip for games starting soon.
  const closing = games.filter((g) => g.date > t && g.date - t <= CLOSE_WINDOW_MS);
  const market = closing.length
    ? await m.step("market", () =>
        collectMarketData(closing, date.replace(/-/g, ""), "close", now, {
          players: new Map(data.ahead.teams.flatMap((t) => t.roster).map((p) => [p.id, p])),
          scoring: data.settings.scoring,
          sp,
        }).catch(async (e) => {
          await log("market-data", "error", (e as Error).message);
          return null;
        }),
      )
    : null;

  const board = buildDayBoard({
    defense: data.defense,
    roster: data.me.roster,
    slotCounts: data.settings.slotCounts,
    games,
    scoreboard: data.scoreboard,
    injuries: data.injuries,
    lineups: data.lineups,
    officialOut: officialOut(date),
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
  const { stored, trades } = await storeHeld();
  const result = {
    date,
    ...watch,
    leagueChanged,
    simRoster,
    lockJob,
    darko,
    returns,
    timeline,
    results,
    lineups,
    closingProps: market?.props ?? 0,
    tradesRefreshed: trades,
    events,
    availability,
    stored,
    alerts: alerts.length,
    sent,
  };
  // Logged only when the run did database work anyway (a log alone would wake Neon).
  if (dbUse.queries > queries) await log("gameday", "ok", JSON.stringify(result));
  return result;
}

/**
 * The context-aware projection's nightly data (ADR-069), from this season's recorded games and
 * the league's player pool (rostered and free players, for positions and names).
 */
async function contextStep(ymd: string, league?: Awaited<ReturnType<typeof loadLeague>>) {
  const sp = Math.min(Math.max(scoringPeriodForDate(ymd), 1), LAST_SCORING_PERIOD);
  const data = league ?? (await loadLeague(sp, ymd));
  const free = await loadFreeAgents(sp).catch(() => []);
  const r = await refreshContext(
    data.games,
    [...data.ahead.teams.flatMap((t) => t.roster), ...free.map((f) => f.player)],
    sp,
  );
  // The league as loaded carries the old context: pages and the simulations reload it.
  forgetResponses();
  return r;
}

/** Fill-ins whose regular is out or back (ADR-064): every rostered and free player's effects. */
async function refreshReturns(sp: number, league: Awaited<ReturnType<typeof loadLeague>>) {
  const free = await loadFreeAgents(sp);
  const r = await refreshTeammateReturns(
    [...league.ahead.teams.flatMap((t) => t.roster), ...free.map((f) => f.player)],
    league.games,
    league.settings.scoring,
    sp,
  );
  // The league as loaded carries the old effects: pages and the simulations reload it.
  forgetResponses();
  return r;
}

/** Once a day, before the games: re-run the season outlook with yesterday's results. */
export async function nightlyJob(): Promise<Record<string, unknown>> {
  const m = new CpuMeter();
  // Each step's CPU too (lib/cpu.ts).
  const metered = <T>(job: string, run: () => Promise<T>, retries: number[] = []) =>
    m.step(job, () => step(job, run, retries));
  try {
    // Before today's games: this week's win chance, for the matchup page's chart. Two retries
    // (a transient ESPN or network error would otherwise leave a day off the chart); the
    // 5-minute job tries again before the first tip if it's still missing.
    const matchup = await metered(
      "matchup-snapshot",
      () => recordMatchupSnapshot(),
      [20_000, 60_000],
    );
    // Every league matchup's state, for calibrating the weekly win probability.
    const states = await metered("matchup-states", () => recordMatchupStates(), [20_000]);
    // Fill-ins whose regular is out or back (ADR-064), before the simulations read the league.
    // Not while the adjustment is off.
    const returns = ADJUSTING
      ? await metered("teammate-returns", async () => {
          const sp = Math.min(Math.max(scoringPeriodForDate(gameDate()), 1), LAST_SCORING_PERIOD);
          return refreshReturns(sp, await loadLeague(sp, gameDate()));
        })
      : null;
    // Box scores and who played (game_participation) for every finished game not recorded yet:
    // yesterday's, and any an earlier run missed. Before the simulations and the defense table.
    const results = await metered("results", async () => {
      const sp = Math.min(Math.max(scoringPeriodForDate(gameDate()), 1), LAST_SCORING_PERIOD);
      const data = await loadLeague(sp, gameDate());
      return recordFinished(
        data.games.filter((g) => g.scoringPeriodId < sp),
        data.settings.scoring,
        RESULTS_PER_NIGHT,
      );
    });
    // Who was out of every team-game this season and each team's regulars now (ADR-069), after
    // last night's box scores and before the simulations read the league.
    const context = await metered("context", () => contextStep(gameDate()));
    // A job left running by runners that went quiet is closed first (the new one replaces it).
    if (workerEnabled()) await metered("quiet-jobs", () => closeQuietJobs());
    // The season simulations: on the GitHub Actions worker when it's set up (the Outlook and
    // deep move checks arrive within minutes), otherwise here.
    const queued = workerEnabled()
      ? await metered("sim-job", () => enqueueSimJob(null).then((id) => ({ job: id })))
      : null;
    const { scoringPeriod, teams } = queued
      ? await latestOutlook().then((r) => ({
          scoringPeriod: r?.scoring_period ?? 0,
          teams: r?.results ?? [],
        }))
      : await m.step("outlook", () => runOutlook());
    // A new day's projections: have the trade ideas ready for the first visit.
    const trades = await metered("trade-targets", () => refreshTradeTargets({ force: true }));
    const moves = queued ? null : await metered("move-checks", () => refreshMoveChecks());
    // PBP Stats season numbers for the player cards (this season and last).
    const season = Number(process.env.ESPN_SEASON || 2027);
    const pbp = await metered("pbp-players", () => refreshPbpPlayers([season, season - 1]));
    // Prior seasons for Trends' "Vs last season" (fetched once, then a no-op).
    const baselines = await metered("season-baselines", () => refreshSeasonBaselines(season));
    // Old simulation jobs (each holds its moves and chunks): the last two days are kept.
    const simJobsPruned = await metered("sim-prune", () => pruneSimJobs());
    const tasksPruned = await metered("task-prune", () => pruneTasks());
    // The job log and sent alerts older than 60 days.
    const logsPruned = await metered("log-prune", () => pruneLogs());
    const workerStarted = await metered("worker-check", () => ensureWorker(0));
    // The league's roster moves, for the team pages' move history (ADR-056).
    const transactions = await metered("transactions", () =>
      syncTransactions(
        Math.min(Math.max(scoringPeriodForDate(gameDate()), 1), LAST_SCORING_PERIOD),
      ),
    );
    // Morning lines and the day's DARKO projections, for the model. Never fails the job.
    const market = await metered("market-data", () => collectToday("morning", true));
    // Opponent defense by position from every result so far (after yesterday's box scores).
    const defense = await metered("defense", () => refreshDefense());
    // The database's usage this month: an alert as transfer or compute nears a limit.
    const neon = await metered("neon-usage", () => checkNeonUsage());
    const me = teams.find((t) => t.teamId === Number(process.env.ESPN_TEAM_ID));
    const result = {
      scoringPeriod,
      title: me?.champ,
      playoffs: me?.playoffs,
      weekWin: matchup?.p_win,
      tradesRefreshed: trades,
      movesChecked: moves,
      pbpPlayers: pbp,
      seasonBaselines: baselines,
      simJobsPruned,
      tasksPruned,
      logsPruned,
      workerStarted,
      transactions,
      defense,
      neon,
      teammateReturns: returns,
      results,
      context,
      ...states,
      ...market,
    };
    await log("nightly", "ok", JSON.stringify(result));
    await recordCpu("nightly", m);
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
  holdStatusEvents(rosterStatuses(data, date), new Date());
  const newStatusEvents = (await storeStatusEvents()).length;
  // Then (yesterday's box scores were recorded by the nightly's results step) re-run the pre-registered props test; the blend weight only moves if it passes.
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
    newStatusEvents,
    ...snap,
    ...blend,
  };
}

/** Finished games this instance has recorded (a recycled instance asks the database again). */
const recordedGames = new Set<number>();
/** The nightly's catch-up: at most this many box scores a night (about half a second each). */
const RESULTS_PER_NIGHT = 120;

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
    const neon = await step("neon-usage", () => checkNeonUsage());
    await log("pregame", "ok", JSON.stringify({ ...result, neon }));
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

/**
 * The availability test's inputs: ESPN's whole injury feed and the latest official report, held
 * until the next store.
 */
async function logAvailabilitySources(
  data: Awaited<ReturnType<typeof loadLeague>>,
  date: string,
  now: Date,
) {
  const espnEvents = holdStatusEvents(
    statusEventsFrom({
      rostered: [],
      injuries: data.injuries,
      lineups: null,
      gameDate: date,
      everyInjury: true,
    }),
    now,
  );
  const official = await logOfficialReport({
    now,
    rostered: data.teams.flatMap((team) => team.roster),
    injuries: data.injuries,
    games: data.games,
  });
  return { ...official, espnEvents };
}

/** Status events (injury feed, NBA.com lineups, ESPN fantasy) for every rostered player. */
function rosterStatuses(data: Awaited<ReturnType<typeof loadLeague>>, date: string) {
  return statusEventsFrom({
    rostered: data.teams.flatMap((team) => team.roster),
    injuries: data.injuries,
    lineups: data.lineups,
    gameDate: date,
  });
}

/** Whether this instance holds logs not stored yet. */
const logsHeld = () => statusHeld() || officialHeld() || timelineHeld() || lineupsHeld();

/**
 * Store everything the 5-minute runs held (status events, official report statuses, timeline
 * points) in one wake of the database. Each is stored with the time it was seen, so only the
 * write waits, not the data (docs/COMPUTE.md §10). One failing leaves the others stored and
 * itself held for the next store.
 */
async function storeHeldLogs(rostered: Set<number>) {
  const failed = (job: string) => async (e: unknown) => {
    await log(job, "error", errorText(e)).catch(() => {});
    return null;
  };
  const events = await storeStatusEvents().catch(failed("status-events"));
  const official = await storeOfficialReports().catch(failed("official-report"));
  const lineups = lineupsHeld() ? await storeLineups().catch(failed("lineup-log")) : null;
  const timeline = timelineHeld() ? await step("matchup-timeline", storeTimeline) : null;
  return {
    events: events?.length ?? null,
    rosteredNews: events?.filter((id) => rostered.has(id)).length ?? 0,
    official,
    lineups,
    timeline,
  };
}
