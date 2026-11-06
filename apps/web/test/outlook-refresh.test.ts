import { describe, expect, it } from "vitest";
import { WATCH_WINDOW_MS, othersWait, othersWithinMinutes } from "@/lib/nba/outlook-refresh";

describe("other teams' moves wait for the 90-minute gap (until Nov 20)", () => {
  const now = Date.parse("2026-11-08T20:00:00Z");
  it("waits when the last job is recent, unless the move is Jack's own", () => {
    expect(othersWait(false, now - 10 * 60_000, now)).toBe(true);
    expect(othersWait(false, now - 89 * 60_000, now)).toBe(true);
    expect(othersWait(true, now - 10 * 60_000, now)).toBe(false);
    expect(othersWait(false, now - 91 * 60_000, now)).toBe(false);
    expect(othersWait(false, null, now)).toBe(false);
  });
  it("stops on Nov 20", () => {
    const later = Date.parse("2026-11-20T01:00:00Z");
    expect(othersWait(false, later - 60_000, later)).toBe(false);
  });

  it("keeps a waiting move in the watch's view until its turn, and says how long", () => {
    expect(WATCH_WINDOW_MS).toBeGreaterThan(90 * 60_000);
    expect(othersWithinMinutes(now)).toBe(90);
    expect(othersWithinMinutes(Date.parse("2026-11-21T00:00:00Z"))).toBe(30);
  });
});
