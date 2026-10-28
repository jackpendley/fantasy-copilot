import { describe, expect, it } from "vitest";
import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import {
  cellFromFinal,
  cellsAhead,
  dayTotal,
  gameOn,
  pairBySlot,
  startingSlots,
  type H2HCell,
  type Placed,
} from "@/lib/nba/h2h";

// Synthetic players and schedule.
const cell = (id: number, points: number | null, proj: number | null = 20): H2HCell => ({
  player: { id, name: `P${id}`, proTeam: "ATL", positions: ["PG"] },
  status: "ACTIVE",
  game: null,
  points,
  proj,
  trend: null,
  line: null,
});
const at = (slot: string, c: H2HCell): Placed => ({ slot, cell: c });
const slotCounts = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 2, BE: 3, IR: 1 };

describe("startingSlots", () => {
  it("lists the starting slots in ESPN order", () => {
    expect(startingSlots(slotCounts)).toEqual([
      "PG",
      "SG",
      "SF",
      "PF",
      "C",
      "G",
      "F",
      "UTIL",
      "UTIL",
    ]);
  });
});

describe("pairBySlot", () => {
  const slots = startingSlots(slotCounts);
  it("lines both teams up slot by slot, leaving gaps where a slot is empty", () => {
    const { rows, bench, ir } = pairBySlot(
      slots,
      [
        at("PG", cell(1, 10)),
        at("UTIL", cell(2, 5)),
        at("UTIL", cell(3, 7)),
        at("BE", cell(4, 0, 30)),
      ],
      [
        at("C", cell(11, 20)),
        at("BE", cell(12, null, 10)),
        at("BE", cell(13, null, 25)),
        at("IR", cell(14, null, null)),
      ],
    );
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ slot: "PG", mine: { player: { id: 1 } }, theirs: null });
    expect(rows[4]).toMatchObject({ slot: "C", mine: null, theirs: { player: { id: 11 } } });
    expect(rows.filter((r) => r.slot === "UTIL").map((r) => r.mine?.player.id)).toEqual([2, 3]);
    expect(bench.mine.map((c) => c.player.id)).toEqual([4]);
    // Bench sorted by points, then projection.
    expect(bench.theirs.map((c) => c.player.id)).toEqual([13, 12]);
    expect(ir.theirs.map((c) => c.player.id)).toEqual([14]);
    expect(dayTotal(rows, "mine", false)).toBe(22);
    expect(dayTotal(rows, "theirs", true)).toBe(20);
  });
});

describe("cells for other days", () => {
  const games: ProGame[] = [
    {
      gameId: 1,
      scoringPeriodId: 3,
      date: Date.parse("2026-10-22T23:00:00Z"),
      homeProTeamId: 1,
      awayProTeamId: 2,
    },
  ];
  const player = (id: number, proTeamId: number, slot = "BE") =>
    ({ id, name: `P${id}`, proTeamId, proTeam: "ATL", positions: ["PG"], slot }) as RosterPlayer;

  it("finds a team's game that day, home or away", () => {
    expect(gameOn(games, 1, 3, "pre")).toMatchObject({ opponent: "BOS", home: true });
    expect(gameOn(games, 2, 3, "post")).toMatchObject({
      opponent: "ATL",
      home: false,
      detail: "Final",
    });
    expect(gameOn(games, 1, 4, "pre")).toBeNull();
  });

  it("marks a final well above its projection", () => {
    const final = cellFromFinal(
      { playerId: 7, slot: "SF", points: 45, line: { PTS: 30 } },
      undefined,
      gameOn(games, 1, 3, "post"),
      30,
    );
    expect(final.slot).toBe("SF");
    expect(final.cell).toMatchObject({
      points: 45,
      proj: 30,
      trend: "up",
      player: { name: "Player 7" },
    });
    // No game that day: nothing to score or compare.
    const idle = cellFromFinal(
      { playerId: 8, slot: "BE", points: 0, line: null },
      undefined,
      null,
      25,
    );
    expect(idle.cell).toMatchObject({ points: null, proj: null, trend: null });
  });

  it("fills starting slots nobody plays in with idle players, as ESPN shows a full lineup", () => {
    const placed = cellsAhead(
      [player(1, 1), player(2, 2), player(3, 9), player(5, 9), player(4, 1, "IR")],
      new Map([[1, "PG"]]),
      games,
      3,
      () => 25,
      () => "ACTIVE",
      () => null,
      ["PG", "UTIL"],
    );
    // Player 2 has a game but no slot was picked for him (bench); 3 fills the open UTIL; 5
    // stays on the bench (no slot left); the IR player stays on IR.
    expect(placed.map((p) => [p.cell.player.id, p.slot])).toEqual([
      [1, "PG"],
      [2, "BE"],
      [3, "UTIL"],
      [5, "BE"],
      [4, "IR"],
    ]);
  });

  it("projects a day ahead: starters in their slots, others with a game on the bench", () => {
    const placed = cellsAhead(
      [player(1, 1), player(2, 2), player(3, 9), player(4, 1, "IR")],
      new Map([[1, "PG"]]),
      games,
      3,
      () => 25,
      () => "ACTIVE",
    );
    expect(placed.map((p) => [p.cell.player.id, p.slot, p.cell.proj])).toEqual([
      [1, "PG", 25],
      [2, "BE", 25],
      [3, "BE", null],
      [4, "IR", 25],
    ]);
  });
});
