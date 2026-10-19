import { describe, expect, it } from "vitest";
import { optimizeLineup, currentPoints, type LineupPlayer } from "../src/lineup";
import {
  expandSlots,
  isStartingSlot,
  slotAccepts,
  NBA_POSITIONS,
  type Position,
} from "../src/slots";

// FOX Champions League roster: PG SG SF PF C G F UTIL UTIL + 3 bench + 1 IR.
const LEAGUE = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 2, BE: 3, IR: 1 };
const STARTING = expandSlots(LEAGUE).filter(isStartingSlot);

let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

function randomEligibility(): Position[] {
  const i = Math.floor(rnd() * 5);
  const pos: Position[] = [NBA_POSITIONS[i]!];
  if (rnd() < 0.5 && i < 4) pos.push(NBA_POSITIONS[i + 1]!);
  return pos;
}

function randomRoster(n = 12): LineupPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    eligible: randomEligibility(),
    value: rnd() < 0.45 ? 0 : Math.round(rnd() * 500) / 10,
    currentSlot: "BE",
  }));
}

/** Exhaustive best starting lineup: try every way to fill the 9 starting slots. */
function bruteForce(all: LineupPlayer[]): number {
  const players = all.filter((p) => p.value > 0); // players without a game add nothing
  let best = 0;
  const used = new Set<number>();
  const go = (s: number, total: number) => {
    if (s === STARTING.length) {
      best = Math.max(best, total);
      return;
    }
    go(s + 1, total); // leave the slot empty / filled by a zero-value player
    for (const p of players) {
      if (used.has(p.id) || !slotAccepts(STARTING[s]!, p.eligible)) continue;
      used.add(p.id);
      go(s + 1, total + p.value);
      used.delete(p.id);
    }
  };
  go(0, 0);
  return best;
}

describe("optimizeLineup", () => {
  it("matches brute force on random rosters", () => {
    for (let t = 0; t < 300; t++) {
      const roster = randomRoster();
      const res = optimizeLineup(roster, LEAGUE);
      expect(res.points).toBeCloseTo(bruteForce(roster), 6);
    }
  });

  it("puts every player in a legal slot and respects starting slot counts", () => {
    for (let t = 0; t < 100; t++) {
      const roster = randomRoster();
      const { slotOf } = optimizeLineup(roster, LEAGUE);
      const used: Record<string, number> = {};
      for (const p of roster) {
        const slot = slotOf.get(p.id)!;
        expect(slot !== "IR" && slotAccepts(slot, p.eligible)).toBe(true);
        used[slot] = (used[slot] ?? 0) + 1;
      }
      for (const [slot, n] of Object.entries(used)) {
        if (slot !== "BE") expect(n).toBeLessThanOrEqual(LEAGUE[slot as keyof typeof LEAGUE]);
      }
    }
  });

  it("leaves a slot empty when nobody can fill it (the bench is unlimited)", () => {
    const roster: LineupPlayer[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      eligible: ["C"],
      value: 20 + i,
      currentSlot: "BE",
    }));
    const res = optimizeLineup(roster, LEAGUE);
    const starters = roster.filter((p) => res.slotOf.get(p.id) !== "BE");
    expect(starters.map((p) => res.slotOf.get(p.id)).sort()).toEqual(["C", "UTIL", "UTIL"]);
    expect(res.points).toBe(31 + 30 + 29);
  });

  it("makes no moves when the current lineup is already optimal", () => {
    const roster = randomRoster();
    const first = optimizeLineup(roster, LEAGUE);
    const settled = roster.map((p) => ({ ...p, currentSlot: first.slotOf.get(p.id)! }));
    const again = optimizeLineup(settled, LEAGUE);
    expect(again.moves).toEqual([]);
    expect(currentPoints(settled)).toBeCloseTo(first.points, 6);
  });

  it("prefers fewer moves among equally good lineups", () => {
    // Two interchangeable guards: the one already starting stays put.
    const roster: LineupPlayer[] = [
      { id: 1, eligible: ["PG", "SG"], value: 30, currentSlot: "G" },
      { id: 2, eligible: ["PG", "SG"], value: 30, currentSlot: "BE" },
      { id: 3, eligible: ["PG"], value: 20, currentSlot: "PG" },
    ];
    const res = optimizeLineup(roster, LEAGUE);
    expect(res.slotOf.get(1)).toBe("G");
    expect(res.slotOf.get(3)).toBe("PG");
    expect(res.moves).toEqual([{ playerId: 2, from: "BE", to: expect.any(String) }]);
  });

  it("never moves a locked player, even off the bench into an open slot", () => {
    const roster: LineupPlayer[] = [
      { id: 1, eligible: ["C"], value: 40, currentSlot: "BE", locked: true },
      { id: 2, eligible: ["C"], value: 10, currentSlot: "C", locked: true },
      { id: 3, eligible: ["C"], value: 25, currentSlot: "BE" },
    ];
    const res = optimizeLineup(roster, LEAGUE);
    expect(res.slotOf.get(1)).toBe("BE");
    expect(res.slotOf.get(2)).toBe("C");
    expect(["UTIL"]).toContain(res.slotOf.get(3));
    expect(res.points).toBe(35);
  });

  it("lets only IR-eligible players use the IR slot", () => {
    const roster: LineupPlayer[] = [
      { id: 1, eligible: ["SF"], value: 0, currentSlot: "IR" }, // healed: must leave IR
      { id: 2, eligible: ["SF"], value: 0, currentSlot: "BE", irEligible: true },
    ];
    const res = optimizeLineup(roster, LEAGUE);
    expect(res.slotOf.get(1)).not.toBe("IR");
    expect(res.moves.find((m) => m.playerId === 1)?.from).toBe("IR");
  });
});
