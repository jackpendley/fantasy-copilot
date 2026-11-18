// Failure alerts and log retention against a real Postgres (test/db/test-db.ts). Rows are
// synthetic; no push is sent (the sender is a stub). Truncates only refresh_log and alerts_sent.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test-db";

const url = testDatabaseUrl();
if (url) process.env.DATABASE_URL = url;

const { db } = await import("@/lib/db");
const { alertOnFailure, pruneLogs } = await import("@/lib/job-alerts");

const logRow = (job: string, status: string, minutesAgo: number) =>
  db()`insert into refresh_log (job, status, detail, ran_at)
    values (${job}, ${status}, 'synthetic', now() - ${`${minutesAgo} minutes`}::interval)`;

describe.skipIf(!url)("failure alerts and log retention (Postgres)", () => {
  const sent: string[] = [];
  const send = async (key: string) => (sent.push(key), true);
  beforeEach(async () => {
    sent.length = 0;
    await db()`truncate refresh_log, alerts_sent`;
  });
  afterAll(async () => {
    await db().end();
  });

  it("pushes on a step's third failure in a row, not before", async () => {
    await logRow("market-data", "ok", 30);
    await logRow("market-data", "error", 20);
    await logRow("market-data", "error", 10);
    expect(await alertOnFailure("market-data", "HTTP 500", send)).toBe(false);
    await logRow("market-data", "error", 0);
    expect(await alertOnFailure("market-data", "HTTP 500", send)).toBe(true);
    expect(sent).toEqual([expect.stringMatching(/^job-fail:market-data:\d{4}-\d{2}-\d{2}$/)]);
  });

  it("pushes on the nightly run's first failure", async () => {
    await logRow("nightly", "ok", 1440);
    await logRow("nightly", "error", 0);
    expect(await alertOnFailure("nightly", "fetch failed", send)).toBe(true);
  });

  it("deletes log rows and sent alerts older than 60 days", async () => {
    await logRow("gameday", "ok", 61 * 1440);
    await logRow("gameday", "ok", 59 * 1440);
    await db()`insert into alerts_sent (dedupe_key, title, body, sent_at)
      values ('old', 't', 'b', now() - interval '61 days'), ('new', 't', 'b', now())`;
    expect(await pruneLogs()).toEqual({ refreshLog: 1, alertsSent: 1 });
    const [left] = await db()`select count(*)::int as n from refresh_log`;
    const keys = await db()`select dedupe_key from alerts_sent`;
    expect([left!.n, keys.map((k) => k.dedupe_key)]).toEqual([1, ["new"]]);
  });
});
