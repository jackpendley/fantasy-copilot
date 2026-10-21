import { describe, expect, it } from "vitest";
import type { PropLine } from "@fantasy-copilot/nba-data";
import { boxPoints, impliedMean, overProbability, vegasProjection } from "@/lib/nba/vegas";

// This league's scoring (no points stat: makes, misses and free throws instead).
const scoring = {
  FGM: 2,
  FGMI: -2,
  FTM: 1,
  FTMI: -1,
  "3PM": 2.5,
  REB: 1.5,
  AST: 2,
  STL: 4,
  BLK: 4,
  TO: -2,
  DD: 5,
  TD: 15,
};
// Synthetic props and box score.
const prop = (market: PropLine["market"], line: number, over = 1.91, under = 1.91): PropLine => ({
  playerId: 1,
  market,
  line,
  over,
  under,
  openLine: line,
  updatedAt: null,
});
const box = {
  PTS: 20,
  FGM: 8,
  FGA: 16,
  FTM: 3,
  FTA: 4,
  "3PM": 1,
  "3PA": 3,
  REB: 6,
  AST: 4,
  STL: 1,
  BLK: 0.5,
  TO: 2,
};

describe("impliedMean", () => {
  it("puts the mean at the line when the over is a coin flip", () => {
    expect(impliedMean(prop("PTS", 22.5))).toBeCloseTo(22.5, 0);
  });
  it("moves the mean above the line when the over is favored, and below when not", () => {
    expect(impliedMean(prop("PTS", 22.5, 1.6, 2.4))).toBeGreaterThan(23);
    expect(impliedMean(prop("REB", 7.5, 2.4, 1.6))).toBeLessThan(7.3);
  });
  it("matches the book's probability for count stats", () => {
    const p = prop("STL", 1.5, 2.2, 1.7);
    const mean = impliedMean(p);
    const over = 1 / 2.2 / (1 / 2.2 + 1 / 1.7);
    expect(overProbability("STL", 1.5, mean)).toBeCloseTo(over, 4);
  });
});

describe("vegasProjection", () => {
  it("scores a box score without bonuses (like ESPN's averages)", () => {
    // 8*2 - 8*2 + 3 - 1 + 2.5 + 9 + 8 + 4 + 2 - 4 = 23.5
    expect(boxPoints(box, scoring)).toBeCloseTo(23.5);
  });

  it("equals the model when every prop sits on the model's numbers", () => {
    const v = vegasProjection(
      [prop("PTS", 19.5, 1.7, 2.2), prop("REB", 5.5, 1.75, 2.1)],
      box,
      23.5,
      scoring,
    )!;
    expect(v.means.PTS).toBeGreaterThan(19.5);
    expect(Math.abs(v.fppg - 23.5)).toBeLessThan(3);
  });

  it("rises with a higher points line (shooting scales) and stays without a points line", () => {
    const low = vegasProjection([prop("PTS", 15.5)], box, 23.5, scoring)!;
    const high = vegasProjection([prop("PTS", 25.5)], box, 23.5, scoring)!;
    expect(high.fppg).toBeGreaterThan(low.fppg);
    expect(vegasProjection([prop("REB", 8.5)], box, 23.5, scoring)).toBeNull();
    expect(vegasProjection([prop("PTS", 20.5)], null, 23.5, scoring)).toBeNull();
  });

  it("replaces covered stats with the props' means", () => {
    const base = vegasProjection([prop("PTS", 20.5)], box, 23.5, scoring)!;
    const boards = vegasProjection([prop("PTS", 20.5), prop("REB", 10.5)], box, 23.5, scoring)!;
    // ~4.5 more rebounds at 1.5 each.
    expect(boards.fppg - base.fppg).toBeGreaterThan(5);
  });
});
