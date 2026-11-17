import { describe, expect, it } from "vitest";
import { parseBox } from "../scripts/boxscore-parse";

// Synthetic box score in the shape of ESPN's site API `summary` (not real data).
const KEYS = [
  "minutes",
  "points",
  "fieldGoalsMade-fieldGoalsAttempted",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted",
  "rebounds",
  "assists",
  "turnovers",
  "steals",
  "blocks",
  "offensiveRebounds",
  "defensiveRebounds",
  "fouls",
  "plusMinus",
];
const side = (abbr: string, players: unknown[]) => ({
  team: { abbreviation: abbr },
  statistics: [{ keys: KEYS, athletes: players }],
});
const box = {
  header: {
    competitions: [
      {
        date: "2005-01-10T00:30Z",
        competitors: [
          { homeAway: "home", team: { abbreviation: "AAA" } },
          { homeAway: "away", team: { abbreviation: "BBB" } },
        ],
      },
    ],
  },
  boxscore: {
    players: [
      side("AAA", [
        {
          athlete: { id: "11", position: { abbreviation: "C" } },
          stats: ["30", "18", "7-12", "0-1", "4-6", "11", "2", "3", "1", "2", "4", "7", "3", "+5"],
        },
        { athlete: { id: "12", position: { abbreviation: "G" } }, didNotPlay: true, stats: [] },
      ]),
      side("BBB", [
        {
          athlete: { id: "21", position: { abbreviation: "F" } },
          stats: ["25", "10", "4-9", "1-3", "1-2", "5", "3", "1", "0", "0", "1", "4", "2", "-5"],
        },
      ]),
    ],
  },
};

describe("box scores as player lines", () => {
  it("maps each stat to the scoring abbreviations, with sides, opponents and home", () => {
    const g = parseBox(7, box);
    expect(g).toMatchObject({ gameId: 7, date: "2005-01-10T00:30Z" });
    expect(g.sides.map((s) => [s.team, s.opponent, s.home])).toEqual([
      ["AAA", "BBB", true],
      ["BBB", "AAA", false],
    ]);
    expect(g.sides[0]!.players[0]).toEqual({
      id: 11,
      pos: "C",
      line: {
        MIN: 30,
        PTS: 18,
        FGM: 7,
        FGA: 12,
        "3PM": 0,
        "3PA": 1,
        FTM: 4,
        FTA: 6,
        REB: 11,
        AST: 2,
        TO: 3,
        STL: 1,
        BLK: 2,
        PF: 3,
      },
    });
  });

  it("leaves out players who didn't play, and refuses a game without a box score", () => {
    expect(parseBox(7, box).sides[0]!.players.map((p) => p.id)).toEqual([11]);
    expect(() => parseBox(8, { header: box.header, boxscore: { players: [] } })).toThrow(
      /no box score/,
    );
  });
});
