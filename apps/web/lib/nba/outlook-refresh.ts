import "server-only";
// Keep the season outlook current. Besides the nightly run, it re-runs whenever a roster move
// lands, from three places: right after an add made in this app, from the 5-minute gameday
// job (which watches ESPN's transaction log), and when someone opens the outlook and it's
// older than the newest move. A lock keeps it to one run at a time.

import { after } from "next/server";
import { fetchLeague, parseTransactions, type LeagueTransaction } from "@fantasy-copilot/espn";
import { db } from "@/lib/db";
import { forgetResponses } from "@/lib/fetch-memo";
import { espnConfig } from "@/lib/env";
import { LAST_SCORING_PERIOD, etDate, scoringPeriodForDate } from "./calendar";
import { leagueMovesBetween } from "./changes";
import { latestOutlook, runOutlook } from "./outlook-run";
import { refreshMoveChecks } from "./move-checks";
import { refreshTradeTargets } from "./trade-view";

const LOCK = "outlook";
/** The roster watch only reads the database when a move is at least this recent. */
export const WATCH_WINDOW_MS = 15 * 60_000;

/** A move newer than the latest run means the outlook is out of date. */
export function isStale(moveAt: number | null, lastRunAt: number | null): boolean {
  return moveAt != null && (lastRunAt == null || moveAt > lastRunAt);
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
  const sp = Math.min(Math.max(scoringPeriodForDate(etDate(now)), 1), LAST_SCORING_PERIOD);
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

/** Is a run under way right now? */
export async function outlookRunning(): Promise<boolean> {
  const rows = await db()`select 1 from job_locks where name = ${LOCK} and until > now()`;
  return rows.length > 0;
}

/** "Team 7 added Player X" for the moves since the last run (newest first). */
async function describeMoves(since: Date, sincePeriod: number): Promise<string | null> {
  const last = await latestOutlook();
  const now = new Date();
  const sp = Math.min(Math.max(scoringPeriodForDate(etDate(now)), 1), LAST_SCORING_PERIOD);
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
  if (!isStale(newest, last?.run_at.getTime() ?? null)) return { watch: "current" };
  after(() => refreshLogged());
  return { watch: "refreshing" };
}

/** For `after()` callbacks: run it and log the outcome (nobody is waiting on a response). */
export async function refreshLogged(trigger?: string | null) {
  const record = (job: string, status: "ok" | "error", detail: string) =>
    db()`insert into refresh_log (job, status, detail) values (${job}, ${status}, ${detail})`.catch(
      () => {},
    );
  try {
    await record("outlook-refresh", "ok", await refreshOutlook(trigger));
  } catch (e) {
    await record("outlook-refresh", "error", (e as Error).message);
  }
  // Rosters changed: have the trade ideas and checked waiver moves ready before a visit.
  try {
    if (await refreshTradeTargets()) await record("trade-targets", "ok", "refreshed");
  } catch (e) {
    await record("trade-targets", "error", (e as Error).message);
  }
  try {
    if (await refreshMoveChecks()) await record("move-checks", "ok", "refreshed");
  } catch (e) {
    await record("move-checks", "error", (e as Error).message);
  }
}
