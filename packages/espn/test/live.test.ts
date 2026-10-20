import { describe, expect, it } from "vitest";
import { parseLiveRosters, parseMatchups } from "../src/index";

// Synthetic: the shape of an mMatchupScore + mBoxscore response, made-up numbers.
const data = {
  schedule: [
    {
      id: 1,
      matchupPeriodId: 2,
      home: {
        teamId: 13,
        totalPoints: 300,
        totalPointsLive: 342.5,
        pointsByScoringPeriod: { "7": 150, "8": 150, "9": 42.5 },
        rosterForCurrentScoringPeriod: {
          appliedStatTotal: 42.5,
          entries: [
            { playerId: 101, lineupSlotId: 0, playerPoolEntry: { id: 101, appliedStatTotal: 30 } },
            {
              playerId: 102,
              lineupSlotId: 12,
              playerPoolEntry: { id: 102, appliedStatTotal: 12.5 },
            },
            { playerId: 103, lineupSlotId: 13, playerPoolEntry: { id: 103, appliedStatTotal: 0 } },
          ],
        },
      },
      away: {
        teamId: 4,
        totalPoints: 310,
        pointsByScoringPeriod: { "7": 160, "8": 150 },
      },
      winner: "UNDECIDED",
    },
    { id: 2, matchupPeriodId: 1, home: { teamId: 13, totalPoints: 900 }, away: { teamId: 5 } },
  ],
};

describe("live matchup parsing", () => {
  it("reads live totals and points by day, falling back to the settled total", () => {
    const m = parseMatchups(data).find((x) => x.period === 2)!;
    expect(m).toMatchObject({ homeLive: 342.5, awayLive: 310, homePoints: 300 });
    expect(m.homeByPeriod).toEqual({ 7: 150, 8: 150, 9: 42.5 });
    expect(m.awayByPeriod).toEqual({ 7: 160, 8: 150 });
  });
  it("reads today's points and slots per player for the matchup period", () => {
    const live = parseLiveRosters(data, 2);
    expect([...live.keys()]).toEqual([13]);
    expect(live.get(13)).toEqual([
      { playerId: 101, slot: "PG", points: 30 },
      { playerId: 102, slot: "BE", points: 12.5 },
      { playerId: 103, slot: "IR", points: 0 },
    ]);
  });
});
