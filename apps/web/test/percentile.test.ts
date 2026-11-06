import { describe, expect, it } from "vitest";
import { ordinal, pctLevel } from "@/lib/percentile";

describe("the 7-level percentile scale", () => {
  it("puts each percentile in Jack's bands", () => {
    const cases: [number, number][] = [
      [100, 3],
      [90, 3],
      [89, 2],
      [75, 2],
      [74, 1],
      [60, 1],
      [59, 0],
      [41, 0],
      [40, -1],
      [26, -1],
      [25, -2],
      [11, -2],
      [10, -3],
      [0, -3],
      [89.6, 3], // rounded first
    ];
    for (const [p, level] of cases) expect(pctLevel(p)).toBe(level);
  });

  it("flips lower-is-better stats, keeps style stats neutral, and skips missing ones", () => {
    expect(pctLevel(95, "low")).toBe(-3); // 95th in turnovers
    expect(pctLevel(5, "low")).toBe(3);
    expect(pctLevel(95, null)).toBe(0);
    expect(pctLevel(null)).toBeNull();
    expect(pctLevel(Number.NaN)).toBeNull();
  });

  it("writes the level as an ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 94, 100].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "94th",
      "100th",
    ]);
  });
});
