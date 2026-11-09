import { describe, expect, it } from "vitest";
import { dayStarts, dayWindows, gameTimeX } from "@/lib/chart-axes";

const H = 3600_000;
// A synthetic two-day week starting at Arizona midnight (07:00 UTC): day 1 has tips at
// 5 PM and 8 PM local, day 2 has no games.
const start = Date.parse("2026-11-09T07:00:00Z");
const windows = dayWindows(start, 2, [[start + 17 * H, start + 20 * H], []]);

describe("the win chance's game-time axis", () => {
  it("gives the morning 10% of the day, the games 85%, the evening the rest", () => {
    expect(gameTimeX(start, windows)).toBe(0);
    expect(gameTimeX(start + 17 * H, windows)).toBeCloseTo(0.1);
    expect(gameTimeX(start + 22.5 * H, windows)).toBeCloseTo(0.95); // last tip + 2.5 h
    expect(gameTimeX(start + 19.75 * H, windows)).toBeCloseTo(0.1 + 0.85 / 2);
    expect(gameTimeX(start + 23.25 * H, windows)).toBeCloseTo(0.975);
  });
  it("keeps days without games on the clock, and clamps outside the week", () => {
    expect(gameTimeX(start + 36 * H, windows)).toBeCloseTo(1.5);
    expect(gameTimeX(start - H, windows)).toBe(0);
    expect(gameTimeX(start + 50 * H, windows)).toBe(2);
  });
  it("stretches a day's games to its last logged point", () => {
    const late = dayWindows(start, 1, [[start + 17 * H]], [start + 21 * H]);
    expect(late[0]!.end).toBe(start + 21 * H);
  });
});

describe("one tick per day", () => {
  it("lists each local midnight from the first day to the last", () => {
    const days = dayStarts(
      Date.parse("2026-10-21T15:00:00Z"),
      Date.parse("2026-10-24T02:00:00Z"),
      7 * H,
    );
    expect(days.map((d) => new Date(d).toISOString())).toEqual([
      "2026-10-21T07:00:00.000Z",
      "2026-10-22T07:00:00.000Z",
      "2026-10-23T07:00:00.000Z",
    ]);
  });
});
