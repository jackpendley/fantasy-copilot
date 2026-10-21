import { describe, expect, it } from "vitest";
import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { dayStarted, pendingMoves, rosterLocked, weekRoster } from "@/lib/nba/roster";
import { projectTeamWeek } from "@/lib/nba/week";
import { isStale, recentMove, WATCH_WINDOW_MS } from "@/lib/nba/outlook-refresh";

// Synthetic players.
const player = (id: number, slot = "BE", fppg = 30, proTeamId = 1): RosterPlayer => ({
  id,
  name: `P${id}`,
  proTeamId,
  proTeam: "X",
  positions: ["PG", "SG", "SF", "PF", "C"],
  slot,
  injuryStatus: "ACTIVE",
  percentOwned: 50,
  percentChange: 0,
  projection: { avg: fppg, total: fppg * 70, stats: {} },
  season: null,
  last7: null,
  last15: null,
  last30: null,
});

describe("pendingMoves", () => {
  it("lists adds, drops and IL moves between today's and tomorrow's rosters", () => {
    const today = [player(1, "PG"), player(2, "BE"), player(3, "IR"), player(4, "C")];
    const ahead = [player(1, "PG"), player(2, "IR"), player(3, "BE"), player(5, "C")];
    const m = pendingMoves(today, ahead);
    expect(m.adds.map((p) => p.id)).toEqual([5]);
    expect(m.drops.map((p) => p.id)).toEqual([4]);
    expect(m.toIR.map((p) => p.id)).toEqual([2]);
    expect(m.fromIR.map((p) => p.id)).toEqual([3]);
  });
  it("is empty when nothing changes", () => {
    const r = [player(1, "PG"), player(2)];
    expect(pendingMoves(r, r)).toEqual({ adds: [], drops: [], toIR: [], fromIR: [] });
  });
});

describe("weekRoster", () => {
  it("keeps today's dropped players for today and starts new ones tomorrow", () => {
    const w = weekRoster([player(1), player(2)], [player(1), player(3)], 4);
    expect(w.roster.map((p) => p.id).sort()).toEqual([1, 2, 3]);
    expect(w.availableFrom.get(3)).toBe(5);
    expect(w.availableUntil.get(2)).toBe(4);
    expect(w.availableFrom.has(1)).toBe(false);
  });
});

describe("roster lock", () => {
  const now = new Date("2026-10-20T20:00:00Z");
  const before = Date.parse("2026-10-20T23:00:00Z");
  const after = Date.parse("2026-10-20T19:00:00Z");
  it("locks once the first game of the day has tipped, under ESPN's first-game rule", () => {
    const rule = { rosterLock: "FIRSTGAME_SCORINGPERIOD" };
    expect(rosterLocked(rule, [before], [{ state: "pre" }], now)).toBe(false);
    expect(rosterLocked(rule, [after, before], [], now)).toBe(true);
    expect(rosterLocked(rule, [before], [{ state: "in" }], now)).toBe(true);
  });
  it("never locks the whole roster under other rules", () => {
    expect(rosterLocked({ rosterLock: "INDIVIDUAL_GAME" }, [after], [], now)).toBe(false);
    expect(dayStarted([after], [], now)).toBe(true);
  });
});

describe("projectTeamWeek availability windows", () => {
  // Team 1 plays days 1-3.
  const games: ProGame[] = [1, 2, 3].map((d) => ({
    gameId: d,
    scoringPeriodId: d,
    date: Date.parse(`2026-10-${19 + d}T23:00:00Z`),
    homeProTeamId: 1,
    awayProTeamId: 2,
  }));
  const input = {
    periods: [1, 2, 3],
    fromPeriod: 1,
    games,
    slotCounts: { UTIL: 1, BE: 3 },
    injuries: [],
  };
  it("counts a new player only from the day he joins, and a dropped one only until he leaves", () => {
    const roster = [player(1, "BE", 30), player(2, "BE", 40)];
    const w = projectTeamWeek(roster, {
      ...input,
      availableFrom: new Map([[2, 2]]),
      availableUntil: new Map([[1, 1]]),
    });
    // Day 1: only P1 (30). Days 2-3: only P2 (40 each).
    expect(w.projectedByDay.get(1)).toBeCloseTo(30);
    expect(w.projectedByDay.get(2)).toBeCloseTo(40);
    expect(w.projectedByDay.get(3)).toBeCloseTo(40);
    expect(w.startsByDay.get(1)).toEqual(new Set([1]));
    expect(w.startsByDay.get(3)).toEqual(new Set([2]));
  });
});

describe("outlook roster watch", () => {
  it("re-runs only for a move newer than the latest run", () => {
    expect(isStale(null, 100)).toBe(false);
    expect(isStale(200, 100)).toBe(true);
    expect(isStale(50, 100)).toBe(false);
    expect(isStale(50, null)).toBe(true);
  });
  it("only looks at the database for a recent move", () => {
    const now = Date.parse("2026-10-20T23:40:00Z");
    expect(recentMove(now - 60_000, now)).toBe(true);
    expect(recentMove(now - WATCH_WINDOW_MS - 1, now)).toBe(false);
    expect(recentMove(null, now)).toBe(false);
  });
});
