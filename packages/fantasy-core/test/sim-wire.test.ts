import { describe, expect, it } from "vitest";
import { simulateSeason, type SimInput, type SimPlayer, type SimTeam } from "../src/sim";
import { applyMove, fromWire, runChunk, toWire } from "../src/sim-wire";
import type { Position } from "../src/slots";

// Synthetic 8-team league (not real data), as in sim.test.ts.
const SLOTS = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 2, BE: 3, IR: 1 };
const POS: Position[][] = [
  ["PG"],
  ["SG"],
  ["SF"],
  ["PF"],
  ["C"],
  ["PG", "SG"],
  ["SF", "PF"],
  ["C"],
];
const team = (id: number, fppg: number): SimTeam => ({
  id,
  roster: Array.from({ length: 12 }, (_, i) => ({
    id: id * 100 + i,
    eligible: POS[i % POS.length]!,
    proTeamId: (i % 6) + 1,
    fppg: fppg - i * 0.5,
    gp: 72,
    sd: 0.1,
  })),
  act: 1,
  addsPerWeek: 0.5,
});
function league(): SimInput {
  const teams = [team(1, 40), ...[2, 3, 4, 5, 6, 7, 8].map((id) => team(id, 30))];
  const ids = teams.map((t) => t.id);
  const matchups: SimInput["matchups"] = [];
  for (let w = 1; w <= 6; w++) {
    const rot = [ids[0]!, ...ids.slice(1).map((_, k) => ids[1 + ((k + w) % (ids.length - 1))]!)];
    for (let k = 0; k < 4; k++)
      matchups.push({ period: w, home: rot[k]!, away: rot[7 - k]!, winner: null });
  }
  const gameDays = new Map<number, Set<number>>();
  for (let pro = 1; pro <= 6; pro++) {
    const days = new Set<number>();
    for (let d = 1 + (pro % 2); d <= 54; d += 2) days.add(d);
    gameDays.set(pro, days);
  }
  const fa: SimPlayer = { id: 999, eligible: ["C"], proTeamId: 1, fppg: 45, gp: 80, sd: 0.1 };
  return {
    teams,
    freeAgents: [fa],
    slotCounts: SLOTS,
    gameDays,
    periodOf: (d) => Math.ceil(d / 6),
    fromDay: 1,
    lastDay: 54,
    matchups,
    regularWeeks: 6,
    banked: new Map([[1, new Map([[1, 0]])]]),
    playoffWeeks: [7, 8, 9],
    addCapPerWeek: 3,
    seasons: 60,
    seed: 5,
  };
}

describe("simulations over the wire", { timeout: 60_000 }, () => {
  it("round-trips through JSON to exactly the same results", () => {
    const input = league();
    const w = JSON.parse(JSON.stringify(toWire(input)));
    expect(simulateSeason(fromWire(w, { seasons: 60, seed: 5 }))).toEqual(simulateSeason(input));
  });

  it("a chunk is deterministic, and a move that changes nothing differs by exactly 0", () => {
    const w = toWire(league());
    const same = { key: "same", roster: w.teams[1]!.roster, freeAgents: w.freeAgents };
    const a = runChunk(w, 2, [same], 3, 40, 2);
    const b = runChunk(w, 2, [same], 3, 40, 2);
    expect(a).toEqual(b);
    for (const m of Object.values(a.moves.same!)) {
      expect(m.n).toBe(40);
      expect(m.sum).toBe(0);
      expect(m.sumsq).toBe(0);
    }
    expect(a.outlook.reduce((s, t) => s + t.champ, 0)).toBeCloseTo(1, 9);
  });

  it("a clearly better player raises the team's odds", () => {
    const w = toWire(league());
    const roster = w.teams[1]!.roster;
    const better = {
      key: "add star",
      roster: [...roster.slice(0, 11), { ...w.freeAgents[0]! }],
      freeAgents: [{ ...roster[11]! }],
    };
    const r = runChunk(w, 2, [better], 1, 200, 4);
    expect(r.moves["add star"]!.wins.sum / 200).toBeGreaterThan(0.3);
  });

  it("a lean move (changed rosters, pool in and out) plays exactly like the whole-pool form", () => {
    const w = toWire(league());
    const roster = w.teams[1]!.roster;
    const legacy = {
      key: "m",
      roster: [...roster.slice(0, 11), { ...w.freeAgents[0]! }],
      freeAgents: [{ ...roster[11]! }],
    };
    const lean = {
      key: "m",
      teams: [{ id: 2, roster: legacy.roster }],
      faOut: [w.freeAgents[0]!.id],
      faIn: [{ ...roster[11]! }],
    };
    expect(applyMove(w, 2, lean)).toEqual(applyMove(w, 2, legacy));
    expect(runChunk(w, 2, [lean], 2, 40, 2)).toEqual(runChunk(w, 2, [legacy], 2, 40, 2));
  });

  it("keeps the pool sorted best first when a move puts players in", () => {
    const w = toWire(league());
    const low = { id: 1, eligible: ["PG" as const], proTeamId: 1, fppg: 1, gp: 80, sd: 0.1 };
    const top = { ...low, id: 2, fppg: 99 };
    const out = applyMove(w, 2, { key: "x", faIn: [low, top] }).freeAgents.map((p) => p.id);
    expect(out).toEqual([2, 999, 1]);
  });
});
