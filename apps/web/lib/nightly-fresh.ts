// What the nightly job writes (the defense table, the props blend, the teammate-return effects,
// the league's average team total) changes once a day, so a server instance re-reads it once
// after each nightly run, not on a timer. A 10- or 30-minute timer re-read it on the 5-minute
// job's runs all day and kept Neon awake (docs/COMPUTE.md §10, Nov 17). Pure.

const DAY_MS = 86_400_000;
/** The nightly job starts at 11:00 UTC (vercel.json, cron-job.org); its writes are in by 11:30. */
export const NIGHTLY_DONE_UTC_MS = 11.5 * 3600_000;

/** When the latest nightly run finished, at or before `now` (ms). */
export function lastNightly(now = Date.now()): number {
  return Math.floor((now - NIGHTLY_DONE_UTC_MS) / DAY_MS) * DAY_MS + NIGHTLY_DONE_UTC_MS;
}

/** A value read at `at` (ms) is still the latest: no nightly run has finished since. */
export const readSinceNightly = (at: number, now = Date.now()) => at >= lastNightly(now);
