import { describe, expect, it } from "vitest";
import { winner, startsLabel } from "@/lib/compare";

// Synthetic rows (not real players).
const row = (av: number | null, bv: number | null, better: "high" | "low" | null) => ({
  label: "x",
  a: null,
  b: null,
  av,
  bv,
  better,
});

describe("compare winner", () => {
  it("picks the higher value, or the lower one where less is better", () => {
    expect(winner(row(25, 22, "high"))).toBe("a");
    expect(winner(row(2.1, 1.4, "low"))).toBe("b");
  });

  it("picks none for ties, missing values and style stats", () => {
    expect(winner(row(5, 5, "high"))).toBeNull();
    expect(winner(row(null, 5, "high"))).toBeNull();
    expect(winner(row(90, 10, null))).toBeNull();
  });
});

describe("starts for you", () => {
  it("counts out of all his games left, and says when the IR-return plan cuts him", () => {
    const card = (cut: { back: string; date: string } | null) => ({
      rest: { gamesLeft: 58, starts: { starts: 1, cut } },
    });
    expect(startsLabel(card({ back: "Jalen Duren", date: "Nov 9" }))).toBe(
      "1 of 58 · cut Nov 9 for Duren",
    );
    expect(startsLabel(card(null))).toBe("1 of 58");
    expect(startsLabel({ rest: { gamesLeft: 10, starts: null } })).toBeNull();
  });
});
