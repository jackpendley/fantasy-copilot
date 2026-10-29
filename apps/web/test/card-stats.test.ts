import { describe, expect, it } from "vitest";
import { contributions, projectedFinal, seasonSplit } from "@/lib/nba/card-stats";

// This league's scoring (docs/LEAGUE.md): no PTS stat; makes and misses carry the scoring.
const SCORING = { FGM: 2, FGMI: -2, FTM: 1, FTMI: -1, REB: 1.5, AST: 2, STL: 4, BLK: 4, TO: -2 };

describe("contributions", () => {
  it("nets makes and misses into one FG and one FT bar", () => {
    // Efficient: 9 of 15 from the field (+18 -12 = +6), 4 of 5 at the line (+4 -1 = +3).
    const c = contributions({ FGM: 9, FGA: 15, FTM: 4, FTA: 5, REB: 8, AST: 3, TO: 2 }, SCORING);
    const fg = c.find((x) => x.stat === "FG")!;
    const ft = c.find((x) => x.stat === "FT")!;
    expect(fg.points).toBeCloseTo(6, 9);
    expect(fg.detail).toBe("9.0/15.0");
    expect(ft.points).toBeCloseTo(3, 9);
    expect(c.map((x) => x.stat)).not.toContain("FGM");
    expect(c.map((x) => x.stat)).not.toContain("FGMI");
    expect(c.find((x) => x.stat === "TO")!.points).toBe(-4);
    // Biggest first: REB 12, FG 6, AST 6, TO -4, FT 3.
    expect(c[0]!.stat).toBe("REB");
  });

  it("shows an inefficient scorer's FG bar as negative", () => {
    const c = contributions({ FGM: 6, FGA: 17 }, SCORING);
    expect(c.find((x) => x.stat === "FG")!.points).toBeCloseTo(12 - 22, 9);
  });

  it("works from misses when attempts are missing", () => {
    const c = contributions({ FGM: 5, FGMI: 5 }, SCORING);
    expect(c.find((x) => x.stat === "FG")!.detail).toBe("5.0/10.0");
    expect(c.find((x) => x.stat === "FG")!.points).toBeCloseTo(0, 9);
  });
});

describe("seasonSplit", () => {
  const games = [10, 20, 30, 40, 50].map((fp, i) => ({
    fp,
    line: { MIN: 30, FGM: 5, FGA: 10, FTM: 2, FTA: 4, REB: i, AST: 2 },
  }));

  it("summarizes the distribution and per-minute production", () => {
    const s = seasonSplit([...games, { fp: 0, line: { MIN: 0 } }])!;
    expect(s.games).toBe(5);
    expect(s.fppg).toBe(30);
    expect(s.median).toBe(30);
    expect(s.floor).toBe(20);
    expect(s.ceiling).toBe(40);
    expect(s.best).toBe(50);
    expect(s.worst).toBe(10);
    expect(s.per36).toBeCloseTo(36, 9);
    expect(s.box["FG%"]).toBe(0.5);
    expect(s.box.REB).toBe(2);
  });

  it("is null without a game played", () => {
    expect(seasonSplit([{ fp: 0, line: { MIN: 0 } }])).toBeNull();
  });
});

describe("projectedFinal", () => {
  it("adds his expected rate over the minutes he should still play", () => {
    expect(
      projectedFinal({ fp: 20, minutes: 18, expectedMinutes: 32, rate: 1, final: false }),
    ).toBe(34);
    // Already past his usual minutes: no more expected.
    expect(
      projectedFinal({ fp: 20, minutes: 35, expectedMinutes: 32, rate: 1, final: false }),
    ).toBe(20);
    expect(projectedFinal({ fp: 41, minutes: 30, expectedMinutes: 36, rate: 1, final: true })).toBe(
      41,
    );
  });
});
