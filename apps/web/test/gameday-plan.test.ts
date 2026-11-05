import { describe, expect, it } from "vitest";
import { gamedayPlan } from "@/lib/nba/gameday-plan";

// A game day with tips at 7:00 and 10:00 PM ET (00:00 and 03:00 UTC the next day).
const tips = [Date.parse("2026-11-07T00:00:00Z"), Date.parse("2026-11-07T03:00:00Z")];
const at = (iso: string, etHour: number, moveSeen = false) => {
  const t = Date.parse(iso);
  return gamedayPlan({ t, minute: new Date(t).getUTCMinutes(), etHour, tips, moveSeen });
};

describe("what the 5-minute job does each run", () => {
  it("loads nothing at night, unless a move was seen or DARKO's hourly look is due", () => {
    expect(at("2026-11-06T09:35:00Z", 4)).toMatchObject({ load: false, availability: false });
    expect(at("2026-11-06T09:35:00Z", 4, true).load).toBe(true);
    expect(at("2026-11-06T11:00:00Z", 6).load).toBe(true); // DARKO, on the hour
    expect(at("2026-11-06T11:05:00Z", 6).load).toBe(false);
  });

  it("logs availability every 10 minutes from 9 AM ET, every 5 in the game window", () => {
    expect(at("2026-11-06T15:00:00Z", 10)).toMatchObject({ load: true, availability: true });
    expect(at("2026-11-06T15:05:00Z", 10)).toMatchObject({ load: false, availability: false });
    expect(at("2026-11-06T15:10:00Z", 10).availability).toBe(true);
    // 23:05 UTC is inside the window (from 90 min before the first tip): every run.
    expect(at("2026-11-06T23:05:00Z", 18)).toMatchObject({ load: true, availability: true });
  });

  it("records the pregame snapshot from 8 AM ET before the first tip, without the league", () => {
    expect(at("2026-11-06T13:05:00Z", 8)).toMatchObject({ load: false, snapshot: true });
    expect(at("2026-11-07T00:30:00Z", 19).snapshot).toBe(false);
  });

  it("keeps the timeline going until 3.5 hours after the last tip", () => {
    expect(at("2026-11-07T06:15:00Z", 1).load).toBe(true);
    expect(at("2026-11-07T06:20:00Z", 1).load).toBe(false);
  });
});
