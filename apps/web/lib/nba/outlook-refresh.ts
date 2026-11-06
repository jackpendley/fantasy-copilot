import "server-only";
// Keep the season outlook current. Besides the nightly run, it re-runs whenever a roster move
// lands, from three places: right after an add made in this app, from the 5-minute gameday
// job (which watches ESPN's transaction log), and when someone opens the League page and it's
// older than the newest move. Other teams' moves re-run it at most every 30 minutes (moves in
// between ride along): each run costs CPU (Vercel Hobby: 4 CPU-hours a month). A lock keeps it
// to one run at a time.

import { after } from "next/server";
import { fetchLeague, parseTransactions, type LeagueTransaction } from "@fantasy-copilot/espn";
import { CpuMeter, recordCpu } from "@/lib/cpu";
import { db } from "@/lib/db";
import { forgetResponses } from "@/lib/fetch-memo";
import { espnConfig } from "@/lib/env";
import { LAST_SCORING_PERIOD, scoringPeriodForDate, gameDate } from "./calendar";
import { leagueMovesBetween } from "./changes";
import { latestOutlook, runOutlook } from "./outlook-run";
import { rosterKeyOf } from "./move-checks";
import { samePlayers } from "./move-shown";
import { enqueueSimJob } from "./sim-jobs";
import { refreshTradeTargets } from "./trade-view";

const LOCK = "outlook";
/** Other teams' moves re-run the outlook at most this often. */
export const RERUN_GAP_MS = 30 * 60_000;
/**
 * The roster watch only reads the database when a move is at least this recent: the longest a
 * move waits (another team's, 90 minutes until Nov 20: OTHERS_GAP_MS) plus 15 minutes, so a
 * waiting move is still seen when its turn comes.
 */
export const WATCH_WINDOW_MS = 90 * 60_000 + 15 * 60_000;

/** A move newer than the latest run means the outlook is out of date. */
export function isStale(moveAt: number | null, lastRunAt: number | null): boolean {
  return moveAt != null && (lastRunAt == null || moveAt > lastRunAt);
}

/**
 * Simulations run on the GitHub Actions worker when it's set up (WORKER_SECRET, ADR-053);
 * otherwise on Vercel, as before.
 */
export const workerEnabled = () => Boolean(process.env.WORKER_SECRET);

/** When the latest simulation job was queued (null when there's none). */
async function lastJobAt(): Promise<number | null> {
  const [j] = await db()<{ created_at: Date }[]>`
    select created_at from sim_jobs where status <> 'superseded' order by id desc limit 1
  `;
  return j?.created_at.getTime() ?? null;
}

/** A worker job queued or running since `since` (a move newer than it isn't in it yet). */
async function liveJobSince(since: number): Promise<{ queuedFor: number } | null> {
  const [j] = await db()<{ status: string; created_at: Date }[]>`
    select status, created_at from sim_jobs
    where status in ('queued', 'running') and created_at >= ${new Date(since)}
    order by id desc limit 1
  `;
  if (!j) return null;
  return { queuedFor: j.status === "queued" ? Date.now() - j.created_at.getTime() : 0 };
}

/**
 * Until Nov 20, 2026, other teams' moves re-check Jack's moves at most every 90 minutes
 * (docs/COMPUTE.md: Vercel's 30-day CPU window needs ~4 min a day until the heavy late-October
 * days roll off; Jack chose 90 on Nov 5). His own moves, and news, are checked right away.
 * Moves in between ride along.
 */
const OTHERS_GAP_UNTIL = Date.parse("2026-11-20T00:00:00Z");
const OTHERS_GAP_MS = 90 * 60_000;

/** At most how long until another team's move is in the numbers (minutes, for the pages). */
export const othersWithinMinutes = (now = Date.now()) =>
  Math.round((now < OTHERS_GAP_UNTIL ? OTHERS_GAP_MS : RERUN_GAP_MS) / 60_000);

/** Should another team's move wait (the last job is recent, and the trim is on)? */
export function othersWait(own: boolean, lastJobAt: number | null, now: number): boolean {
  return !own && now < OTHERS_GAP_UNTIL && lastJobAt != null && now - lastJobAt < OTHERS_GAP_MS;
}

/** The worker hasn't picked a job up in this long: Vercel runs the Outlook itself. */
const WORKER_FALLBACK_MS = 15 * 60_000;

/**
 * A move newer than the latest run: queue it for the worker (right away), or re-run on Vercel
 * (at most every 30 minutes). Returns what happened.
 */
export async function refreshIfStale(
  newest: number | null,
  lastRunAt: number | null,
  now = Date.now(),
  own = true,
): Promise<"current" | "queued" | "refreshing" | "waiting"> {
  if (!isStale(newest, lastRunAt)) return "current";
  if (workerEnabled()) {
    const live = await liveJobSince(newest!);
    if (live && live.queuedFor < WORKER_FALLBACK_MS) return "queued";
    if (othersWait(own, await lastJobAt(), now)) return "waiting";
    after(() => (live ? refreshVercel() : refreshLogged()));
    return "refreshing";
  }
  if (!dueForRerun(newest, lastRunAt, now)) return "waiting";
  after(() => refreshLogged());
  return "refreshing";
}

/** Out of date, and the last run is old enough to run again (coalesces bursts of moves). */
export function dueForRerun(moveAt: number | null, lastRunAt: number | null, now: number): boolean {
  return isStale(moveAt, lastRunAt) && (lastRunAt == null || now - lastRunAt >= RERUN_GAP_MS);
}

/** Should the 5-minute watch look further (read the last run)? Only for a recent move. */
export function recentMove(moveAt: number | null, now: number): boolean {
  return moveAt != null && now - moveAt <= WATCH_WINDOW_MS;
}

/**
 * The league's adds, drops and trades in today's and tomorrow's transaction logs, oldest
 * first (ESPN files a move made after today's lock under either day).
 */
export async function recentLeagueMoves(now = new Date()): Promise<LeagueTransaction[]> {
  if (process.env.ESPN_LEAGUE_FILE) return [];
  const sp = Math.min(Math.max(scoringPeriodForDate(gameDate(now)), 1), LAST_SCORING_PERIOD);
  const cfg = espnConfig();
  const periods = sp < LAST_SCORING_PERIOD ? [sp, sp + 1] : [sp];
  const lists = await Promise.all(
    periods.map((p) =>
      fetchLeague(cfg, ["mTransactions2"], { scoringPeriodId: p }).then(parseTransactions),
    ),
  );
  return lists.flat().sort((a, b) => a.at - b.at);
}

/** Take the lock unless another run holds it (a lock older than 5 minutes is abandoned). */
async function acquire(): Promise<boolean> {
  const rows = await db()`
    insert into job_locks (name, until) values (${LOCK}, now() + interval '5 minutes')
    on conflict (name) do update set until = excluded.until where job_locks.until < now()
    returning name
  `;
  return rows.length > 0;
}

async function release() {
  await db()`delete from job_locks where name = ${LOCK}`;
}

/** Is a run under way right now (on Vercel, or a worker job runners are on)? */
export async function outlookRunning(): Promise<boolean> {
  const rows = await db()`
    select 1 from job_locks where name = ${LOCK} and until > now()
    union all
    select 1 from sim_jobs where status = 'running' and last_worker_at > now() - interval '3 minutes'
  `;
  return rows.length > 0;
}

/** "Team 7 added Player X" for the moves since the last run (newest first). */
async function describeMoves(since: Date, sincePeriod: number): Promise<string | null> {
  const last = await latestOutlook();
  const now = new Date();
  const sp = Math.min(Math.max(scoringPeriodForDate(gameDate(now)), 1), LAST_SCORING_PERIOD);
  const moves = await leagueMovesBetween(since, now, sincePeriod, sp + 1).catch(() => []);
  if (!moves.length) return null;
  const teamName = new Map((last?.results ?? []).map((t) => [t.teamId, t.name]));
  const m = moves[moves.length - 1]!;
  const who = teamName.get(m.teamId) ?? "A team";
  const list = (ps: { name: string }[]) => ps.map((p) => p.name).join(", ");
  const what =
    m.type === "TRADE"
      ? `traded for ${list(m.adds)}`
      : [m.adds.length && `added ${list(m.adds)}`, m.drops.length && `dropped ${list(m.drops)}`]
          .filter(Boolean)
          .join(", ");
  const more = moves.length > 1 ? ` (+${moves.length - 1} more)` : "";
  return `${who} ${what}${more}`;
}

/**
 * Re-run the outlook unless a run is already under way. `trigger` labels the run; when it's
 * omitted the label comes from the league's moves since the previous run.
 */
export async function refreshOutlook(trigger?: string | null): Promise<"ran" | "busy"> {
  if (!(await acquire())) return "busy";
  try {
    const last = await latestOutlook();
    const label =
      trigger !== undefined
        ? trigger
        : last
          ? await describeMoves(last.run_at, last.scoring_period).catch(() => null)
          : null;
    await runOutlook(undefined, label);
    return "ran";
  } finally {
    await release();
  }
}

/**
 * The 5-minute watch: re-run when a league move landed after the latest run. Reads only ESPN
 * unless a move is recent, so the database can stay asleep between moves. The run itself
 * happens after the response (`after`), so the cron caller isn't kept waiting ~30 s.
 */
export async function rosterWatch(now = new Date()): Promise<Record<string, unknown>> {
  const moves = await recentLeagueMoves(now);
  const newest = moves.at(-1)?.at ?? null;
  if (!recentMove(newest, now.getTime())) return { watch: "quiet" };
  // Rosters changed: later reads go back to ESPN.
  forgetResponses();
  const last = await latestOutlook();
  const lastRunAt = last?.run_at.getTime() ?? null;
  // A move by Jack's own team (e.g. made in the ESPN app) is checked right away.
  const own = moves.some(
    (m) => m.teamId === espnConfig().teamId && (lastRunAt == null || m.at > lastRunAt),
  );
  return { watch: await refreshIfStale(newest, lastRunAt, now.getTime(), own) };
}

/** News or IR-slot changes queue a new simulation job at most this often. */
const NEWS_GAP = "5 minutes";

/**
 * Jack's roster as the latest simulation job saw it vs now (from the league the 5-minute job
 * already loaded): his players' injury news or IR slots changed means his moves need a re-check.
 * His adds and drops are queued by the roster watch; this catches what the transaction log
 * doesn't. A job for news queued in the last 5 minutes waits for the next run.
 */
export async function simRosterCheck(
  roster: Parameters<typeof rosterKeyOf>[0],
  injuries: Parameters<typeof rosterKeyOf>[1],
): Promise<"current" | "waiting" | "queued"> {
  if (!workerEnabled()) return "current";
  const key = rosterKeyOf(roster, injuries);
  const [j] = await db()<{ roster_key: string | null; recent: boolean; live: boolean }[]>`
    select roster_key, created_at > now() - ${NEWS_GAP}::interval as recent,
      status in ('queued', 'running') as live
    from sim_jobs where status <> 'superseded' order by id desc limit 1
  `;
  if (!j?.roster_key || j.roster_key === key) return "current";
  const news = samePlayers(j.roster_key, key);
  if (news && j.live && j.recent) return "waiting";
  await refreshLogged(news ? "Injury news for your players" : "Your roster changed (IR or slots)");
  return "queued";
}

const record = (job: string, status: "ok" | "error", detail: string) =>
  db()`insert into refresh_log (job, status, detail) values (${job}, ${status}, ${detail})`.catch(
    () => {},
  );

/** The Outlook on Vercel (2,000 seasons): without the worker, or when it isn't starting. */
async function refreshVercel(trigger?: string | null) {
  try {
    await record("outlook-refresh", "ok", await refreshOutlook(trigger));
  } catch (e) {
    await record("outlook-refresh", "error", (e as Error).message);
  }
}

/**
 * For `after()` callbacks: queue the season for the worker (or re-run it on Vercel), then
 * refresh the trade ideas; log the outcome (nobody is waiting on a response).
 */
export async function refreshLogged(trigger?: string | null) {
  const m = new CpuMeter();
  if (workerEnabled()) {
    try {
      const last = await latestOutlook();
      const label =
        trigger !== undefined
          ? trigger
          : last
            ? await describeMoves(last.run_at, last.scoring_period).catch(() => null)
            : null;
      const job = await enqueueSimJob(label, [], m);
      await record("sim-job", "ok", job ? `queued job ${job}` : "queued its build on the worker");
    } catch (e) {
      await record("sim-job", "error", (e as Error).message);
      await m.step("outlook", () => refreshVercel(trigger));
    }
  } else {
    await m.step("outlook", () => refreshVercel(trigger));
  }
  // Rosters changed: have the trade ideas ready before a visit. Jack's own moves refresh them
  // now; other teams' at most every 3 hours (the search costs ~7.5 s of CPU).
  const own = trigger?.startsWith("You ") ?? false;
  try {
    if (await m.step("trades", () => refreshTradeTargets({ force: own })))
      await record("trade-targets", "ok", "refreshed");
  } catch (e) {
    await record("trade-targets", "error", (e as Error).message);
  }
  await recordCpu("roster-move", m, { trigger: trigger ?? null });
}
