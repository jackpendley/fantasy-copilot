import { describe, expect, it } from "vitest";
import { fantasyPoints, scoringFromEspn, withDerived } from "../src/scoring.js";
import { irEligible, normalizeStatus, playProbability } from "../src/availability.js";

// FOX Champions League 2026-27 scoring (no PTS stat; makes/misses instead).
const LEAGUE = {
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
  QD: 25,
};

describe("scoring", () => {
  it("derives misses and multi-doubles from a box line", () => {
    const line = withDerived({
      PTS: 28,
      REB: 13,
      AST: 11,
      STL: 1,
      BLK: 0,
      FGM: 11,
      FGA: 19,
      FTM: 4,
      FTA: 5,
      "3PM": 2,
      "3PA": 5,
      TO: 3,
    });
    expect(line).toMatchObject({ FGMI: 8, FTMI: 1, "3PMI": 3, DD: 1, TD: 1, QD: 0 });
  });

  it("scores a triple-double line under league rules", () => {
    const line = withDerived({
      PTS: 28,
      REB: 13,
      AST: 11,
      STL: 1,
      BLK: 0,
      FGM: 11,
      FGA: 19,
      FTM: 4,
      FTA: 5,
      "3PM": 2,
      "3PA": 5,
      TO: 3,
    });
    // 22 - 16 + 4 - 1 + 5 + 19.5 + 22 + 4 + 0 - 6 + 5 + 15 = 73.5
    expect(fantasyPoints(line, LEAGUE)).toBeCloseTo(73.5, 6);
  });

  it("keeps stats that are already present", () => {
    expect(withDerived({ FGM: 1, FGA: 3, FGMI: 5 }).FGMI).toBe(5);
  });

  it("maps ESPN scoring items by stat id", () => {
    expect(
      scoringFromEspn(
        [
          { statId: 13, points: 2 },
          { statId: 999, points: 1 },
        ],
        { 13: "FGM" },
      ),
    ).toEqual({ FGM: 2 });
  });
});

describe("availability priors", () => {
  it("normalizes ESPN status spellings", () => {
    expect(normalizeStatus("Day-To-Day")).toBe("DAY_TO_DAY");
    expect(normalizeStatus(undefined)).toBe("ACTIVE");
  });

  it("orders statuses sensibly", () => {
    const order = ["ACTIVE", "PROBABLE", "DAY_TO_DAY", "QUESTIONABLE", "DOUBTFUL", "OUT"].map(
      playProbability,
    );
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(playProbability("Out")).toBe(0);
  });

  it("allows IR only for ruled-out players", () => {
    expect(irEligible("OUT")).toBe(true);
    expect(irEligible("DAY_TO_DAY")).toBe(false);
  });
});
