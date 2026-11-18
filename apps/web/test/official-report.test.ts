import { describe, expect, it } from "vitest";
import type { ProGame } from "@fantasy-copilot/espn";
import type { InjuryReport, OfficialInjuryReport } from "@fantasy-copilot/nba-data";
import { matchPool, officialStatusRows, statusChanges } from "@/lib/nba/official-report";
import { statusEventsFrom } from "@/lib/nba/news";

// Synthetic players and report (made-up names); ESPN team ids 18 = NY, 20 = PHI.
const players = [
  { id: 1, name: "Test Guard", team: "NY" },
  { id: 2, name: "Demo Center", team: "PHI" },
];
const games: ProGame[] = [
  {
    gameId: 501,
    scoringPeriodId: 10,
    date: Date.parse("2026-11-02T00:00:00Z"),
    homeProTeamId: 20,
    awayProTeamId: 18,
  },
];
const report: OfficialInjuryReport = {
  publishedAt: "2026-11-01T21:00:00.000Z",
  entries: [
    {
      gameDate: "2026-11-01",
      gameTime: "19:00",
      matchup: "NYK@PHI",
      team: "New York Knicks",
      teamAbbr: "NYK",
      name: "Test Guard",
      status: "Questionable",
      reason: "Injury/Illness - Left Ankle; Sprain",
    },
    {
      gameDate: "2026-11-01",
      gameTime: "19:00",
      matchup: "NYK@PHI",
      team: "Philadelphia 76ers",
      teamAbbr: "PHI",
      name: "Demo Center",
      status: "Out",
      reason: "Rest",
    },
    {
      gameDate: "2026-11-01",
      gameTime: "19:00",
      matchup: "NYK@PHI",
      team: "Philadelphia 76ers",
      teamAbbr: "PHI",
      name: "Unknown Twoway",
      status: "Out",
      reason: "G League - Two-Way",
    },
  ],
};

describe("officialStatusRows", () => {
  it("matches listed players to ESPN ids and to the scheduled game, with the report's time", () => {
    const rows = officialStatusRows(report, players, games);
    expect(rows).toEqual([
      {
        playerId: 1,
        gameId: 501,
        gameDate: "2026-11-01",
        tip: "2026-11-02T00:00:00.000Z",
        status: "Questionable",
        reason: "Injury/Illness - Left Ankle; Sprain",
        publishedAt: "2026-11-01T21:00:00.000Z",
      },
      {
        playerId: 2,
        gameId: 501,
        gameDate: "2026-11-01",
        tip: "2026-11-02T00:00:00.000Z",
        status: "Out",
        reason: "Rest",
        publishedAt: "2026-11-01T21:00:00.000Z",
      },
    ]);
  });
});

describe("matchPool", () => {
  it("adds ESPN injury-feed players to the rostered ones, with their team", () => {
    const injury = {
      playerId: 3,
      name: "Feed Forward",
      teamId: 18,
      status: "Day-To-Day",
      short: "",
      long: "",
      date: "",
    } as InjuryReport;
    expect(matchPool([], [injury])).toEqual([{ id: 3, name: "Feed Forward", team: "NY" }]);
  });
});

describe("statusEventsFrom everyInjury", () => {
  it("logs every player on ESPN's injury feed for the availability test", () => {
    const injury = {
      playerId: 3,
      name: "Feed Forward",
      teamId: 18,
      status: "Day-To-Day",
      short: "Ankle",
      long: "",
      date: "2026-11-01T15:00:00Z",
    } as InjuryReport;
    const events = statusEventsFrom({
      rostered: [],
      injuries: [injury],
      lineups: null,
      gameDate: "2026-11-01",
      everyInjury: true,
    });
    expect(events).toEqual([
      expect.objectContaining({ playerId: 3, source: "espn_injuries", status: "DAY_TO_DAY" }),
    ]);
    expect(
      statusEventsFrom({ rostered: [], injuries: [injury], lineups: null, gameDate: "2026-11-01" }),
    ).toEqual([]);
  });
});

describe("statusChanges (held reports, stored together)", () => {
  const row = (playerId: number, status: string, publishedAt: string) =>
    ({
      playerId,
      gameId: 501,
      gameDate: "2026-11-01",
      tip: null,
      status,
      reason: "",
      publishedAt,
    }) as Parameters<typeof statusChanges>[0][number];

  it("keeps each change in report order, each with its own report's time", () => {
    const held = [
      row(1, "Questionable", "2026-11-01T20:00:00Z"),
      row(1, "Out", "2026-11-01T20:15:00Z"),
      row(1, "Out", "2026-11-01T20:30:00Z"),
      row(2, "Out", "2026-11-01T20:15:00Z"),
    ];
    const latest = [{ player_id: 2, game_date: "2026-11-01", status: "Out" }];
    expect(statusChanges(held, latest).map((r) => [r.playerId, r.status, r.publishedAt])).toEqual([
      [1, "Questionable", "2026-11-01T20:00:00Z"],
      [1, "Out", "2026-11-01T20:15:00Z"],
    ]);
  });

  it("logs a status that flips back (Questionable, Out, Questionable)", () => {
    const held = [
      row(1, "Out", "2026-11-01T20:15:00Z"),
      row(1, "Questionable", "2026-11-01T20:30:00Z"),
    ];
    const latest = [{ player_id: 1, game_date: "2026-11-01", status: "Questionable" }];
    expect(statusChanges(held, latest).map((r) => r.status)).toEqual(["Out", "Questionable"]);
  });
});
