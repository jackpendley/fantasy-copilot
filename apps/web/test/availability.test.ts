import { describe, expect, it } from "vitest";
import { absenceOf, absences, returnLabel } from "@/lib/nba/availability";
import { LAST_SCORING_PERIOD, scoringPeriodForDate } from "@/lib/nba/calendar";

// Synthetic players; today is scoring period 8 (Oct 27).
const today = 8;
const player = (id: number, injuryStatus = "ACTIVE") => ({ id, injuryStatus });

describe("absenceOf", () => {
  it("keeps a ruled-out player out until ESPN's estimated return", () => {
    const a = absenceOf(player(1), { status: "Out", returnDate: "2026-11-09" }, today)!;
    expect(a.outUntil).toBe(scoringPeriodForDate("2026-11-09"));
    expect(a.season).toBe(false);
    expect(returnLabel(a)).toBe("back ~Nov 9");
  });
  it("marks a return after the fantasy season as out for the season", () => {
    const a = absenceOf(player(1), { status: "Out", returnDate: "2027-04-20" }, today)!;
    expect(a.season).toBe(true);
    expect(a.outUntil).toBeGreaterThan(LAST_SCORING_PERIOD);
    expect(returnLabel(a)).toBe("out for the season");
  });
  it("treats a passed date as tomorrow and no date as a week", () => {
    expect(absenceOf(player(1), { status: "Out", returnDate: "2026-10-20" }, today)!.outUntil).toBe(
      today + 1,
    );
    expect(absenceOf(player(1, "OUT"), undefined, today)!.outUntil).toBe(today + 7);
  });
  it("ignores day-to-day and healthy players (daily play chances cover them)", () => {
    expect(
      absenceOf(player(1), { status: "Day-To-Day", returnDate: "2026-10-28" }, today),
    ).toBeNull();
    expect(absenceOf(player(1), undefined, today)).toBeNull();
  });
  it("maps a roster to its absences", () => {
    const m = absences(
      [player(1), player(2, "OUT"), player(3)],
      [{ playerId: 1, status: "Out", returnDate: "2026-12-14" }],
      today,
    );
    expect([...m.keys()].sort()).toEqual([1, 2]);
  });
});
