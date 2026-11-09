import { describe, expect, it } from "vitest";
import type { FantasyTeam } from "@fantasy-copilot/espn";
import { recordOf, weekSide } from "@/lib/nba/week-summary";

// Synthetic teams (not real data).
const team = (id: number, wins: number, losses: number, pointsFor: number, ties = 0) =>
  ({ id, wins, losses, ties, pointsFor }) as FantasyTeam;

describe("the scoreboard's record", () => {
  const teams = [team(1, 3, 1, 900), team(2, 3, 1, 950), team(3, 1, 3, 800), team(4, 2, 1, 700, 1)];
  it("shows wins-losses and the place by wins, then points for", () => {
    expect(recordOf(teams[0]!, teams)).toBe("3-1 · 2nd");
    expect(recordOf(teams[1]!, teams)).toBe("3-1 · 1st");
    expect(recordOf(teams[3]!, teams)).toBe("2-1-1 · 3rd");
    expect(recordOf(teams[2]!, teams)).toBe("1-3 · 4th");
  });
});

describe("the scoreboard's starts and points per start", () => {
  it("splits the week at today's tips", () => {
    const s = weekSide({
      pastStarts: 20,
      todayStarted: 4,
      todayLeft: 3,
      aheadStarts: 18,
      banked: 720,
      remaining: 630,
    });
    expect(s).toMatchObject({
      startsSoFar: 24,
      startsLeft: 21,
      perStartSoFar: 30,
      perStartLeft: 30,
    });
  });
  it("has no per-start numbers without starts", () => {
    const s = weekSide({
      pastStarts: 0,
      todayStarted: 0,
      todayLeft: 0,
      aheadStarts: 0,
      banked: 0,
      remaining: 0,
    });
    expect(s.perStartSoFar).toBeNull();
    expect(s.perStartLeft).toBeNull();
  });
});
