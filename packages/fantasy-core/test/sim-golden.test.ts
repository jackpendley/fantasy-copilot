import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SimInput, SimPlayer, SimTeam } from "../src/sim";
import { runChunk, toWire, type WireMove } from "../src/sim-wire";
import type { Position } from "../src/slots";

// The simulator's exact output, fixed: speed work must leave every number as it was (ADR-070).
// A synthetic league (not real data) that takes every path: streaming with and without fit,
// managers who don't check daily, known injuries, an IR slot with its cut, a later waiver
// claim, points that change mid-season, playoff replays, and a move.
const SLOTS = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3, BE: 3, IR: 1 };
const POS: Position[][] = [
  ["PG"],
  ["SG"],
  ["SF"],
  ["PF"],
  ["C"],
  ["PG", "SG"],
  ["SF", "PF"],
  ["PF", "C"],
];
const player = (id: number, fppg: number, i: number): SimPlayer => ({
  id,
  eligible: POS[i % POS.length]!,
  proTeamId: (id % 30) + 1,
  fppg,
  gp: i % 3 === 0 ? 62 : 76,
  sd: 0.12,
});
function league(fitStreams: boolean): SimInput {
  const teams: SimTeam[] = Array.from({ length: 12 }, (_, t) => ({
    id: t + 1,
    roster: Array.from({ length: 13 }, (_, i) =>
      player((t + 1) * 100 + i, 44 - i * 2 - t * 0.4, i),
    ),
    act: t % 3 === 0 ? 0.6 : 0.95,
    addsPerWeek: t % 4 === 0 ? 0.1 : 1.2,
  }));
  const me = teams[0]!;
  me.roster[2] = { ...me.roster[2]!, outUntil: 30 };
  me.roster[12] = { ...me.roster[12]!, reserve: true, outUntil: 40 };
  me.irCut = me.roster[11]!.id;
  me.roster[4] = {
    ...me.roster[4]!,
    changes: [
      { day: 25, fppg: 41 },
      { day: 60, fppg: 36 },
    ],
  };
  teams[3]!.next = { day: 22, drop: teams[3]!.roster[10]!.id, add: player(9001, 27, 2) };
  const ids = teams.map((t) => t.id);
  const matchups: SimInput["matchups"] = [];
  for (let w = 1; w <= 12; w++) {
    const rot = [ids[0]!, ...ids.slice(1).map((_, k) => ids[1 + ((k + w) % (ids.length - 1))]!)];
    for (let k = 0; k < 6; k++)
      matchups.push({
        period: w,
        home: rot[k]!,
        away: rot[11 - k]!,
        winner: w < 3 ? "HOME" : null,
      });
  }
  const gameDays = new Map<number, Set<number>>();
  for (let pro = 1; pro <= 30; pro++) {
    const days = new Set<number>();
    for (let d = 1 + (pro % 2); d <= 105; d += pro % 3 === 0 ? 3 : 2) days.add(d);
    gameDays.set(pro, days);
  }
  return {
    teams,
    freeAgents: Array.from({ length: 60 }, (_, i) => player(5000 + i, 26 - i * 0.25, i)),
    slotCounts: SLOTS,
    gameDays,
    periodOf: (d) => Math.ceil(d / 7),
    fromDay: 18,
    lastDay: 105,
    matchups,
    regularWeeks: 12,
    banked: new Map([[3, new Map(ids.map((id) => [id, 50 + id]))]]),
    playoffWeeks: [13, 14, 15],
    addCapPerWeek: 4,
    seasons: 1,
    seed: 11,
    fitStreams,
  };
}
const moveOf = (l: SimInput): WireMove => {
  const me = l.teams[0]!;
  const add = l.freeAgents[0]!;
  const drop = me.roster[9]!;
  return {
    key: `${add.id}:${drop.id}:`,
    roster: me.roster.map((p) => (p === drop ? add : p)),
    faOut: [add.id],
    faIn: [drop],
  };
};
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

describe("the simulator's numbers", { timeout: 120_000 }, () => {
  it("are exactly as fixed, with streaming by fit", () => {
    const l = league(true);
    expect(hash(runChunk(toWire(l), 1, [moveOf(l)], 3, 60, 3))).toBe(
      "f3e4a7b4506021e1f5b36aacf98a39bfa2ff8f2c0a714bee6b3932a8ffa4c615",
    );
  });

  it("are exactly as fixed, with the raw-value streaming rule", () => {
    const l = league(false);
    expect(hash(runChunk(toWire(l), 1, [moveOf(l)], 3, 60, 3))).toBe(
      "06f5b186de8700d57ee0c707045568669adf15c6d7ff91abd301bbea2ab73e88",
    );
  });
});
