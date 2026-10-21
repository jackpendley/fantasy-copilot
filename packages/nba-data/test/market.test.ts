import { describe, expect, it } from "vitest";
import { darkoPerGame, noVigOver, parseDarko, parsePropBets, unflatten } from "../src/index";

// Synthetic payloads in the shapes ESPN's core API and DARKO's data endpoint return.
const prop = (athlete: number, type: string, line: number, price: number, open = line) => ({
  athlete: { $ref: `http://sports.core.api.espn.com/v2/.../athletes/${athlete}?lang=en` },
  type: { id: "1", name: type },
  odds: { decimal: { value: price.toFixed(2) } },
  lastUpdated: "2026-10-20T22:00Z",
  current: { target: { value: line } },
  open: { target: { value: open } },
});

describe("parsePropBets", () => {
  it("pairs over and under prices per player and market (first item is the over)", () => {
    const lines = parsePropBets({
      items: [
        prop(1, "Total Points", 22.5, 1.87, 21.5),
        prop(1, "Total Points", 22.5, 1.95, 21.5),
        prop(1, "Total Rebounds", 7.5, 2.1),
        prop(1, "Total Rebounds", 7.5, 1.75),
        prop(1, "Points Milestones", 20, 1.5), // one-sided ladder: not a market we read
        prop(2, "Total Assists", 4.5, 1.9), // missing its under: skipped
        { type: { name: "Total Points" } }, // no athlete: skipped
      ],
    });
    expect(lines).toEqual([
      {
        playerId: 1,
        market: "PTS",
        line: 22.5,
        over: 1.87,
        under: 1.95,
        openLine: 21.5,
        updatedAt: "2026-10-20T22:00Z",
      },
      {
        playerId: 1,
        market: "REB",
        line: 7.5,
        over: 2.1,
        under: 1.75,
        openLine: 7.5,
        updatedAt: "2026-10-20T22:00Z",
      },
    ]);
  });

  it("removes the bookmaker margin", () => {
    expect(noVigOver(1.91, 1.91)).toBeCloseTo(0.5);
    expect(noVigOver(1.5, 2.6)).toBeCloseTo(0.634, 3);
  });
});

describe("DARKO", () => {
  // devalue: index 0 is the root object; values point at other indices.
  const flat = [
    { players: 1, asOf: 3 },
    [2],
    {
      nba_id: 4,
      player_name: 5,
      team_name: 6,
      x_minutes: 7,
      x_pace: 8,
      x_pts_100: 9,
      x_fga_100: 10,
      x_fg_pct: 11,
      x_orb_100: 12,
      x_drb_100: 13,
    },
    "2026-10-21",
    101,
    "Test Player",
    "Test Team",
    36,
    100,
    30,
    25,
    0.5,
    2,
    10,
  ];

  it("rebuilds the devalue payload", () => {
    expect(unflatten(flat).players[0].player_name).toBe("Test Player");
  });

  it("parses players and converts per-100 rates to per-game stats", () => {
    const { asOf, players } = parseDarko({ nodes: [null, { type: "data", data: flat }] });
    expect(asOf).toBe("2026-10-21");
    expect(players).toHaveLength(1);
    const g = darkoPerGame(players[0]!);
    // 36 minutes at pace 100 = 75 possessions: 30 pts/100 -> 22.5.
    expect(g.PTS).toBeCloseTo(22.5);
    expect(g.FGA).toBeCloseTo(18.75);
    expect(g.FGM).toBeCloseTo(9.375);
    expect(g.REB).toBeCloseTo(9);
    expect(g.AST).toBe(0);
  });
});
