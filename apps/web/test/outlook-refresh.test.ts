import { describe, expect, it } from "vitest";
import { othersWait, othersWithinMinutes, watchWindowMs } from "@/lib/nba/outlook-refresh";

describe("other teams' moves wait: nightly in minimal mode (until Nov 21), 6 hours under the saver (until Nov 29)", () => {
  const now = Date.parse("2026-11-12T20:00:00Z");
  it("waits for the nightly job in minimal mode, unless the move is Jack's own", () => {
    expect(othersWait(false, now - 10 * 60_000, now)).toBe(true);
    expect(othersWait(false, now - 23 * 3600_000, now)).toBe(true);
    expect(othersWait(true, now - 10 * 60_000, now)).toBe(false);
    expect(othersWait(false, now - 25 * 3600_000, now)).toBe(false);
    expect(othersWait(false, null, now)).toBe(false);
  });
  it("waits 6 hours from Nov 21 and stops on Nov 29", () => {
    const saver = Date.parse("2026-11-23T20:00:00Z");
    expect(othersWait(false, saver - 359 * 60_000, saver)).toBe(true);
    expect(othersWait(false, saver - 361 * 60_000, saver)).toBe(false);
    const later = Date.parse("2026-11-29T01:00:00Z");
    expect(othersWait(false, later - 60_000, later)).toBe(false);
  });
  it("says how long a waiting move takes", () => {
    expect(othersWithinMinutes(now)).toBe(24 * 60);
    expect(othersWithinMinutes(Date.parse("2026-11-23T00:00:00Z"))).toBe(360);
    expect(othersWithinMinutes(Date.parse("2026-11-30T00:00:00Z"))).toBe(30);
    expect(watchWindowMs(Date.parse("2026-11-23T20:00:00Z"))).toBeGreaterThan(6 * 3600_000);
  });
});
