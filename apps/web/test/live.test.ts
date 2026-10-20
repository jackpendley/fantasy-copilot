import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import type { ScoreboardGame } from "@fantasy-copilot/nba-data";
import type { DayRow } from "@/lib/nba/day";
import { gameElapsed, liveRows, sortLive } from "@/lib/nba/live";

describe("gameElapsed", () => {
  const g = (state: ScoreboardGame["state"], period: number, clock: string) => ({
    state,
    period,
    clock,
  });
  it("is 0 before tip and 1 when final or in overtime", () => {
    expect(gameElapsed(g("pre", 0, "0:00"))).toBe(0);
    expect(gameElapsed(g("post", 4, "0.0"))).toBe(1);
    expect(gameElapsed(g("in", 5, "3:00"))).toBe(1);
  });
  it("counts quarters and the clock", () => {
    expect(gameElapsed(g("in", 1, "12:00"))).toBe(0);
    expect(gameElapsed(g("in", 3, "6:00"))).toBeCloseTo(30 / 48, 6);
    // Last minute: seconds only.
    expect(gameElapsed(g("in", 4, "30.0"))).toBeCloseTo(47.5 / 48, 6);
  });
});

// Synthetic players and games.
const player = (id: number): RosterPlayer => ({
  id,
  name: `P${id}`,
  proTeamId: id,
  proTeam: "X",
  positions: ["PG"],
  slot: "PG",
  injuryStatus: "ACTIVE",
  percentOwned: 0,
  percentChange: 0,
  projection: null,
  season: null,
  last7: null,
  last15: null,
  last30: null,
});
const row = (id: number, state: "pre" | "in" | "post" | null, value: number, slot = "PG"): DayRow =>
  ({
    player: player(id),
    game: state
      ? { gameId: id, opponent: "BOS", home: id % 2 === 0, tip: "", state, detail: "" }
      : null,
    locked: state === "in" || state === "post",
    status: "ACTIVE",
    injuryNote: null,
    playProb: 1,
    projection: { fppg: value, source: "espn" },
    value: state ? value : 0,
    currentSlot: slot,
    recommendedSlot: slot,
    nba: null,
  }) as unknown as DayRow;
const sb = (
  gameId: number,
  state: ScoreboardGame["state"],
  period: number,
  clock: string,
): ScoreboardGame => ({
  gameId,
  tip: "",
  state,
  detail: "",
  homeTeamId: 1,
  awayTeamId: 2,
  homeScore: state === "pre" ? null : 60,
  awayScore: state === "pre" ? null : 55,
  spread: null,
  total: null,
  period,
  clock,
});

describe("liveRows", () => {
  const board = [
    row(1, "in", 40),
    row(2, "post", 30),
    row(3, "pre", 20),
    row(4, "pre", 25, "BE"),
    row(5, null, 0),
  ];
  const scoreboard = [sb(1, "in", 3, "0:00"), sb(2, "post", 4, "0.0"), sb(3, "pre", 0, "")];
  const live = [
    { playerId: 1, slot: "PG", points: 22 },
    { playerId: 2, slot: "SG", points: 31.5 },
    { playerId: 4, slot: "BE", points: 0 },
  ];
  const rows = liveRows(board, live, scoreboard);
  const by = (id: number) => rows.find((r) => r.row.player.id === id)!;

  it("projects what's still to come for starters only", () => {
    expect(by(1).toCome).toBeCloseTo(10, 6); // 3 quarters done: a quarter of 40 left
    expect(by(2).toCome).toBe(0); // final
    expect(by(3).toCome).toBe(20); // not started
    expect(by(4).toCome).toBe(0); // bench
    expect(by(5).toCome).toBe(0); // no game
  });
  it("uses ESPN's slot and points, and the score from his team's side", () => {
    expect(by(2)).toMatchObject({ slot: "SG", points: 31.5, score: { us: 60, them: 55 } }); // home
    expect(by(1).score).toEqual({ us: 55, them: 60 }); // away
    expect(by(3).score).toBeNull();
  });
  it("sorts live games first, then finals, then later games", () => {
    expect(sortLive(rows).map((r) => r.row.player.id)).toEqual([1, 2, 4, 3, 5]);
  });
});
