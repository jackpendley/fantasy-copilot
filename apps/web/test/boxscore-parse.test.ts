import { describe, expect, it } from "vitest";
import { cleanSeason, parseBox } from "../scripts/boxscore-parse";

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

// Synthetic season pieces for cleanSeason (not real data).
const player = (id: number, pts: number) => ({ id, pos: "", line: { MIN: 30, PTS: pts } });
const game = (gameId: number, date: string, teams: [string, string], pts: number, n = 6) => ({
  gameId,
  date,
  sides: teams.map((team, k) => ({
    team,
    opponent: teams[1 - k]!,
    home: k === 0,
    players: Array.from({ length: n }, (_, i) => player((k + 1) * 100 + i, pts + i)),
  })),
});

describe("a season's games", () => {
  // Two real teams with 40+ appearances each.
  const filler = Array.from({ length: 40 }, (_, i) =>
    game(
      1000 + i,
      `2005-0${1 + (i % 3)}-${String(10 + (i % 18)).padStart(2, "0")}T00:00Z`,
      ["AAA", "BBB"],
      20 + i,
    ),
  );

  it("drops empty records, odd-team records and exact duplicates", () => {
    const empty = {
      ...game(1, "2005-01-01T00:00Z", ["AAA", "BBB"], 5),
      sides: game(1, "2005-01-01T00:00Z", ["AAA", "BBB"], 5).sides.map((s) => ({
        ...s,
        players: [],
      })),
    };
    const odd = game(2, "2005-01-02T00:00Z", ["AAA", "VANCOUVER"], 5);
    const original = game(3, "2005-01-03T00:00Z", ["AAA", "BBB"], 9);
    const copy = { ...game(400003, "2005-01-03T05:00Z", ["AAA", "BBB"], 9) };
    const out = cleanSeason([...filler, empty, odd, original, copy]);
    expect(out).toMatchObject({ empty: 1, odd: 1, duplicates: 1 });
    expect(out.kept.map((g) => g.gameId)).toContain(3);
    expect(out.kept.map((g) => g.gameId)).not.toContain(400003);
  });

  it("treats a side as missing when a player with stats has no minutes", () => {
    const whole = game(6, "2005-01-06T00:00Z", ["AAA", "BBB"], 13);
    const noMinutes = {
      ...whole,
      sides: whole.sides.map((s) => ({
        ...s,
        players: s.players.map((p) => ({ ...p, line: { ...p.line, MIN: 0 } })),
      })),
    };
    const partial = game(7, "2005-01-07T00:00Z", ["AAA", "BBB"], 14);
    partial.sides[0]!.players[0]!.line.MIN = 0;
    // A player listed with nothing at all (no minutes, no stats) doesn't make it missing.
    const fine = game(8, "2005-01-08T00:00Z", ["AAA", "BBB"], 15);
    fine.sides[0]!.players[0]!.line = { MIN: 0, PTS: 0 };
    const out = cleanSeason([...filler, noMinutes, partial, fine]);
    // Game 6: both sides lack minutes (2 sides, game dropped). Game 7: one side (kept, that
    // side without players).
    expect(out.noMinutes).toBe(3);
    const kept = new Map(out.kept.map((g) => [g.gameId, g]));
    expect(kept.has(6)).toBe(false);
    expect(kept.get(7)!.sides.map((s) => s.players.length)).toEqual([0, 6]);
    expect(kept.get(8)!.sides.map((s) => s.players.length)).toEqual([6, 6]);
  });

  it("keeps two real games between the same teams on consecutive days", () => {
    const first = game(4, "2005-01-04T00:00Z", ["AAA", "BBB"], 11);
    const second = game(5, "2005-01-05T00:00Z", ["AAA", "BBB"], 12);
    const out = cleanSeason([...filler, first, second]);
    expect(out.duplicates).toBe(0);
    expect(out.kept.map((g) => g.gameId)).toEqual(expect.arrayContaining([4, 5]));
  });
});
