// The 5-minute job's held logs against a real Postgres (test/db/test-db.ts): status events
// (lib/nba/status-log.ts) and official-report statuses (lib/nba/official-report.ts), stored
// together with the time each was seen (docs/COMPUTE.md §10). Every row here is synthetic.
// Database test files share one database and run in parallel, so each truncates only the
// tables it uses.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "./test-db";

const url = testDatabaseUrl();
if (url) process.env.DATABASE_URL = url;

// The official report is read from the league's CDN: here, synthetic reports.
const report = vi.hoisted(() => ({ next: null as unknown }));
vi.mock("@fantasy-copilot/nba-data", async (actual) => ({
  ...(await actual<typeof import("@fantasy-copilot/nba-data")>()),
  fetchInjuryReport: async () => report.next,
}));

const { db, dbUse } = await import("@/lib/db");
const { holdStatusEvents, storeStatusEvents } = await import("@/lib/nba/status-log");
const { logOfficialReport, storeOfficialReports } = await import("@/lib/nba/official-report");

describe.skipIf(!url)("the 5-minute job's held logs (Postgres)", () => {
  beforeEach(async () => {
    await db()`truncate status_events, official_status restart identity`;
    await db()`delete from model_settings where key = 'official_report_last'`;
  });
  afterAll(async () => {
    await db().end();
  });

  it("stores status events with when they were first seen, once each", async () => {
    const seen = new Date("2026-11-17T23:05:00Z");
    const out = {
      playerId: 7,
      source: "espn_injuries",
      status: "OUT",
      detail: "synthetic",
      publishedAt: null,
      gameDate: "2026-11-17",
    } as Parameters<typeof holdStatusEvents>[0][number];
    expect(holdStatusEvents([out], seen)).toBe(1);
    // Seen again on later runs: already held.
    expect(holdStatusEvents([out], new Date("2026-11-17T23:10:00Z"))).toBe(0);
    expect(await storeStatusEvents()).toEqual([7]);
    const rows = await db()`select player_id, observed_at from status_events`;
    expect(rows.map((r) => [r.player_id, (r.observed_at as Date).toISOString()])).toEqual([
      [7, seen.toISOString()],
    ]);
    // Stored: the next runs neither hold it nor query.
    expect(holdStatusEvents([out], new Date())).toBe(0);
    const queries = dbUse.queries;
    expect(await storeStatusEvents()).toEqual([]);
    expect(dbUse.queries).toBe(queries);
  });

  it("stores each official report's changes with the report's time, in one store", async () => {
    // Synthetic: made-up players on ESPN teams 18 (NY) and 20 (PHI), game at 7 PM ET.
    const rostered = [{ id: 1, name: "Test Guard", proTeam: "NY" }] as Parameters<
      typeof logOfficialReport
    >[0]["rostered"];
    const games = [
      {
        gameId: 501,
        scoringPeriodId: 10,
        date: Date.parse("2026-11-18T00:00:00Z"),
        homeProTeamId: 20,
        awayProTeamId: 18,
      },
    ];
    const entry = (status: string) => ({
      gameDate: "2026-11-17",
      gameTime: "19:00",
      matchup: "NYK@PHI",
      team: "New York Knicks",
      teamAbbr: "NYK",
      name: "Test Guard",
      status,
      reason: "Injury/Illness - Left Ankle; Sprain",
    });
    const read = async (at: string, status: string) => {
      report.next = { publishedAt: at, entries: [entry(status)] };
      return logOfficialReport({ now: new Date(at), rostered, injuries: [], games });
    };
    const queries = dbUse.queries;
    expect(await read("2026-11-17T21:00:00.000Z", "Questionable")).toMatchObject({ held: 1 });
    expect(await read("2026-11-17T21:15:00.000Z", "Out")).toMatchObject({ held: 2 });
    // Unchanged in the next report: nothing more held.
    expect(await read("2026-11-17T21:30:00.000Z", "Out")).toMatchObject({ held: 2 });
    // Reading reports sent no query (Neon sleeps between stores).
    expect(dbUse.queries).toBe(queries);

    expect(await storeOfficialReports()).toBe(2);
    const rows = await db()`
      select status, published_at from official_status order by published_at`;
    expect(rows.map((r) => [r.status, (r.published_at as Date).toISOString()])).toEqual([
      ["Questionable", "2026-11-17T21:00:00.000Z"],
      ["Out", "2026-11-17T21:15:00.000Z"],
    ]);
    const after = dbUse.queries;
    expect(await storeOfficialReports()).toBe(0);
    expect(dbUse.queries).toBe(after);
  });
});
