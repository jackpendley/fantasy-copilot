// Who played in each game against a real Postgres (test/db/test-db.ts): finished games'
// results and participation (lib/nba/market-data.ts) and NBA.com's lineup log
// (lib/nba/lineup-log.ts). Every row here is synthetic. Database test files share one
// database and run in parallel, so each truncates only the tables it uses.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "./test-db";

const url = testDatabaseUrl();
if (url) process.env.DATABASE_URL = url;

// ESPN's game summaries: synthetic, per game id; a missing one fails like a network error.
const summaries = vi.hoisted(() => new Map<number, unknown>());
const fetched = vi.hoisted(() => [] as number[]);
vi.mock("@fantasy-copilot/nba-data", async (actual) => ({
  ...(await actual<typeof import("@fantasy-copilot/nba-data")>()),
  fetchGameSummary: async (id: number) => {
    fetched.push(id);
    if (!summaries.has(id)) throw new Error("fetch failed");
    return summaries.get(id);
  },
}));

const { db } = await import("@/lib/db");
const { recordFinished } = await import("@/lib/nba/market-data");
const { holdLineups, storeLineups } = await import("@/lib/nba/lineup-log");

/** A synthetic finished game: one player who played, one DNP. */
const summary = (state = "post") => ({
  header: { competitions: [{ status: { type: { state } } }] },
  boxscore: {
    players: [
      {
        team: { id: "18" },
        statistics: [
          {
            names: ["MIN", "PTS"],
            athletes: [
              { athlete: { id: "1" }, starter: true, stats: ["30", "20"] },
              { athlete: { id: "2" }, didNotPlay: true, stats: [], reason: "COACH'S DECISION" },
            ],
          },
        ],
      },
    ],
  },
});
const game = (gameId: number, date: number) => ({
  gameId,
  date,
  scoringPeriodId: 1,
  homeProTeamId: 18,
  awayProTeamId: 20,
});

describe.skipIf(!url)("who played (Postgres)", () => {
  beforeEach(async () => {
    await db()`truncate game_results, game_participation, lineup_log`;
    summaries.clear();
    fetched.length = 0;
  });
  afterAll(async () => {
    await db().end();
  });

  it("records each finished game's results and who played or didn't, once", async () => {
    summaries.set(101, summary());
    const r = await recordFinished([game(101, 1)], { PTS: 1 });
    expect(r).toEqual({ results: 1, gamesRecorded: 1, left: 0 });
    const rows = await db()`
      select player_id, played, starter, minutes, reason from game_participation order by player_id
    `;
    expect(rows.map((x) => ({ ...x }))).toEqual([
      { player_id: 1, played: true, starter: true, minutes: 30, reason: null },
      { player_id: 2, played: false, starter: false, minutes: 0, reason: "COACH'S DECISION" },
    ]);
    expect((await db()`select fp from game_results`).map((x) => x.fp)).toEqual([20]);
    // Recorded: a later run doesn't fetch it again.
    fetched.length = 0;
    expect(await recordFinished([game(101, 1)], { PTS: 1 })).toMatchObject({ gamesRecorded: 0 });
    expect(fetched).toEqual([]);
  });

  it("leaves a failed or unfinished game for a later run, oldest first within the limit", async () => {
    summaries.set(201, summary("in"));
    summaries.set(203, summary());
    summaries.set(204, summary());
    const games = [game(204, 4), game(203, 3), game(202, 2), game(201, 1)];
    // 201 isn't final and 202 fails; with a limit of 3, 204 waits.
    expect(await recordFinished(games, { PTS: 1 }, 3)).toEqual({
      results: 1,
      gamesRecorded: 1,
      left: 3,
    });
    expect(fetched).toEqual([201, 202, 203]);
    summaries.set(201, summary());
    summaries.set(202, summary());
    expect(await recordFinished(games, { PTS: 1 })).toMatchObject({ gamesRecorded: 3, left: 0 });
  });

  it("logs each lineup state once, with when it was first seen", async () => {
    const entry = {
      nbaPersonId: 9,
      name: "Test Center",
      team: "NYK",
      gameId: "0022600300",
      lineupStatus: "Expected",
      rosterStatus: "Active",
      position: "C",
      starter: true,
      timestamp: "2026-11-19T18:00:00",
    };
    const first = new Date("2026-11-19T23:00:00Z");
    expect(holdLineups([entry], "2026-11-19", first)).toBe(1);
    expect(holdLineups([entry], "2026-11-19", new Date("2026-11-19T23:05:00Z"))).toBe(0);
    // A late scratch: the same player listed inactive.
    const late = new Date("2026-11-19T23:40:00Z");
    expect(
      holdLineups(
        [{ ...entry, rosterStatus: "Inactive", starter: false, position: "" }],
        "2026-11-19",
        late,
      ),
    ).toBe(1);
    expect(await storeLineups()).toBe(2);
    const rows = await db()`
      select team, inactive, starter, observed_at from lineup_log order by observed_at
    `;
    expect(
      rows.map((r) => [r.team, r.inactive, r.starter, (r.observed_at as Date).toISOString()]),
    ).toEqual([
      ["NY", false, true, first.toISOString()],
      ["NY", true, false, late.toISOString()],
    ]);
    expect(await storeLineups()).toBe(0);
  });
});
