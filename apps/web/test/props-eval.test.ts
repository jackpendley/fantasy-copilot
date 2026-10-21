import { describe, expect, it } from "vitest";
import { evaluateProps, type EvalRow } from "@/lib/nba/props-eval";

// Synthetic: 20 players over 10 days.
function rows(vegasNoise: number, modelNoise: number): EvalRow[] {
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  const out: EvalRow[] = [];
  for (let d = 1; d <= 10; d++)
    for (let p = 1; p <= 90; p++) {
      const truth = 20 + (p % 7) * 3;
      out.push({
        playerId: p,
        day: `2026-10-${String(20 + d).padStart(2, "0")}`,
        model: truth + modelNoise * rand(),
        vegas: truth + vegasNoise * rand(),
        actual: truth + 8 * rand(),
      });
    }
  return out;
}

describe("evaluateProps", () => {
  it("waits for 7 game days and 800 games", () => {
    expect(evaluateProps(rows(2, 6).slice(0, 500))).toBeNull();
  });

  it("ships a blend when Vegas is clearly better, with a weight fitted on the first half", () => {
    const e = evaluateProps(rows(1, 12))!;
    expect(e.days).toBe(10);
    expect(e.weight).toBeGreaterThan(0.5);
    expect(e.test.blend.mae).toBeLessThan(e.test.model.mae);
    expect(e.test.blend.vsModel!.hi).toBeLessThan(0);
    expect(e.ships).toBe(true);
  });

  it("doesn't ship when Vegas adds nothing", () => {
    const e = evaluateProps(rows(12, 1))!;
    expect(e.weight).toBeLessThan(0.3);
    expect(e.ships).toBe(false);
  });
});
