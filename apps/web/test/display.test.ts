import { describe, expect, it } from "vitest";
import { compactClock, compactGame, compactStats } from "@/lib/display";

describe("compact phone labels", () => {
  it("compacts ESPN's game status", () => {
    expect(compactClock("5:12 - 3rd")).toBe("Q3 5:12");
    expect(compactClock("10:37 - 4th")).toBe("Q4 10:37");
    expect(compactClock("0:42.3 - 1st")).toBe("Q1 0:42.3");
    expect(compactClock("2:01 - OT")).toBe("OT 2:01");
    expect(compactClock("2:01 - 2OT")).toBe("OT2 2:01");
    expect(compactClock("End of 3rd")).toBe("End Q3");
    expect(compactClock("Halftime")).toBe("Half");
    expect(compactClock("7:00 PM")).toBe("7:00p");
  });

  const g = { opponent: "BOS", home: false, detail: "", score: null };
  it("formats a game in one short line", () => {
    expect(compactGame({ ...g, state: "pre", when: "7:00 PM" })).toBe("@BOS 7:00p");
    expect(
      compactGame({ ...g, state: "in", detail: "10:37 - 4th", score: { us: 82, them: 77 } }),
    ).toBe("@BOS 82-77 Q4 10:37");
    expect(
      compactGame({
        ...g,
        home: true,
        opponent: "PHI",
        state: "post",
        score: { us: 121, them: 113 },
      }),
    ).toBe("vs PHI W 121-113");
    expect(compactGame(null)).toBe("No game");
  });

  it("fits a 375 px half cell (~126 px of text): 23 characters at most", () => {
    const longest = compactGame({
      ...g,
      home: true,
      state: "in",
      detail: "10:37 - 4th",
      score: { us: 118, them: 121 },
    });
    expect(longest).toBe("vs BOS 118-121 Q4 10:37");
    expect(longest.length).toBeLessThanOrEqual(23);
  });

  it("abbreviates the stat line", () => {
    expect(compactStats({ PTS: 22, REB: 9, AST: 4, STL: 1, BLK: 0, "3PM": 3 })).toBe(
      "22p 9r 4a 1s",
    );
    expect(compactStats({ PTS: 0 })).toBe("0p");
    expect(compactStats(null)).toBeNull();
  });
});
