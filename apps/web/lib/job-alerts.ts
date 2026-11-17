import "server-only";
// Failures that need Jack, not just a line on Settings: a push when the nightly or pregame run
// fails (each runs once a day, so one failure is a missed day), or when any other step has
// failed its last few runs in a row. At most one push per job per day (alerts_sent). And the
// logs' retention: refresh_log and alerts_sent rows older than 60 days are deleted nightly
// (every alert key carries its day or billing period, so none can repeat).

import { db } from "./db";
import { sendAlertOnce, type PushMessage } from "./push";
import { gameDate } from "./nba/calendar";

/** Jobs that alert on their first failure. */
const AT_ONCE = new Set(["nightly", "pregame"]);
/** Failures in a row before any other step alerts. */
export const FAILURES_IN_A_ROW = 3;
const KEEP_DAYS = 60;

/** Is an alert due, given the job's latest statuses (newest first, including this failure)? */
export function failureAlertDue(job: string, recent: string[]): boolean {
  if (AT_ONCE.has(job)) return recent[0] === "error";
  return (
    recent.length >= FAILURES_IN_A_ROW &&
    recent.slice(0, FAILURES_IN_A_ROW).every((s) => s === "error")
  );
}

/** After a failure was logged: push it if it's due. Returns whether a push went out. */
export async function alertOnFailure(
  job: string,
  detail: string,
  send: (key: string, msg: PushMessage) => Promise<boolean> = sendAlertOnce,
): Promise<boolean> {
  const rows = await db()<{ status: string }[]>`
    select status from refresh_log where job = ${job} order by ran_at desc, id desc
    limit ${FAILURES_IN_A_ROW}
  `;
  if (
    !failureAlertDue(
      job,
      rows.map((r) => r.status),
    )
  )
    return false;
  return send(`job-fail:${job}:${gameDate()}`, {
    title: AT_ONCE.has(job) ? `The ${job} run failed` : `"${job}" keeps failing`,
    body: detail.slice(0, 180),
    url: "/settings",
  });
}

/** Nightly: delete log rows older than 60 days. */
export async function pruneLogs(): Promise<{ refreshLog: number; alertsSent: number }> {
  const logs = await db()`
    delete from refresh_log where ran_at < now() - ${`${KEEP_DAYS} days`}::interval returning id
  `;
  const alerts = await db()`
    delete from alerts_sent where sent_at < now() - ${`${KEEP_DAYS} days`}::interval returning id
  `;
  return { refreshLog: logs.length, alertsSent: alerts.length };
}
