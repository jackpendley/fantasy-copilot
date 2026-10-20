import { describe, expect, it } from "vitest";
import {
  parseDraftPicks,
  parseLiveRosters,
  parseMatchups,
  parseTransactions,
  playerIdsFilter,
} from "../src/index";

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
            {
              playerId: 101,
              lineupSlotId: 0,
              playerPoolEntry: {
                id: 101,
                appliedStatTotal: 30,
                player: {
                  stats: [
                    // PTS 0, REB 6, AST 3, FGM 13, FGA 14, MIN 40
                    {
                      id: "05401",
                      statSourceId: 0,
                      statSplitTypeId: 5,
                      scoringPeriodId: 9,
                      appliedTotal: 30,
                      stats: { 0: 20, 6: 8, 3: 5, 13: 8, 14: 15, 40: 34 },
                    },
                  ],
                },
              },
            },
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

describe("playerIdsFilter", () => {
  it("never sends a limit (ESPN requires a sort with one)", () => {
    expect(playerIdsFilter([1, 2])).toEqual({ players: { filterIds: { value: [1, 2] } } });
  });
});

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
      {
        playerId: 101,
        slot: "PG",
        points: 30,
        line: { PTS: 20, REB: 8, AST: 5, FGM: 8, FGA: 15, MIN: 34 },
      },
      { playerId: 102, slot: "BE", points: 12.5, line: null },
      { playerId: 103, slot: "IR", points: 0, line: null },
    ]);
  });
});

describe("parseDraftPicks", () => {
  it("maps drafted players to their overall pick, skipping keepers", () => {
    // Synthetic mDraftDetail shape.
    const picks = parseDraftPicks({
      draftDetail: {
        picks: [
          { playerId: 11, overallPickNumber: 1, keeper: false },
          { playerId: 12, overallPickNumber: 2, keeper: true },
          { playerId: 13, overallPickNumber: 30 },
        ],
      },
    });
    expect([...picks]).toEqual([
      [11, 1],
      [13, 30],
    ]);
  });
});

describe("parseTransactions", () => {
  // Synthetic mTransactions2 shape.
  const data = {
    transactions: [
      { status: "EXECUTED", type: "FUTURE_ROSTER", teamId: 1, processDate: 1, items: [] },
      {
        status: "EXECUTED",
        type: "WAIVER",
        teamId: 4,
        processDate: 300,
        items: [
          { type: "ADD", playerId: 10, toTeamId: 4 },
          { type: "DROP", playerId: 11, fromTeamId: 4 },
        ],
      },
      { status: "CANCELED", type: "WAIVER", teamId: 5, processDate: 300, items: [] },
      {
        status: "EXECUTED",
        type: "TRADE_ACCEPT",
        teamId: 6,
        processDate: 200,
        items: [
          { type: "TRADE", playerId: 20, fromTeamId: 6, toTeamId: 7 },
          { type: "TRADE", playerId: 21, fromTeamId: 7, toTeamId: 6 },
        ],
      },
    ],
  };
  it("keeps executed adds, drops and trades, oldest first, one trade entry per team", () => {
    expect(parseTransactions(data)).toEqual([
      { type: "TRADE", teamId: 6, at: 200, adds: [21], drops: [20] },
      { type: "TRADE", teamId: 7, at: 200, adds: [20], drops: [21] },
      { type: "WAIVER", teamId: 4, at: 300, adds: [10], drops: [11] },
    ]);
  });
});
