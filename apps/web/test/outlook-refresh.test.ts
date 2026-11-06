import { describe, expect, it } from "vitest";
import { othersWait, othersWithinMinutes, watchWindowMs } from "@/lib/nba/outlook-refresh";

describe("other teams' moves wait: 6 hours under the CPU saver (until Nov 22), then 90 minutes", () => {
  const now = Date.parse("2026-11-08T20:00:00Z");
  it("waits 6 hours under the saver, unless the move is Jack's own", () => {
    expect(othersWait(false, now - 10 * 60_000, now)).toBe(true);
    expect(othersWait(false, now - 359 * 60_000, now)).toBe(true);
    expect(othersWait(true, now - 10 * 60_000, now)).toBe(false);
    expect(othersWait(false, now - 361 * 60_000, now)).toBe(false);
    expect(othersWait(false, null, now)).toBe(false);
  });
  it("waits 90 minutes from Nov 22 and stops on Nov 29", () => {
    const after = Date.parse("2026-11-23T20:00:00Z");
    expect(othersWait(false, after - 89 * 60_000, after)).toBe(true);
    expect(othersWait(false, after - 91 * 60_000, after)).toBe(false);
    const later = Date.parse("2026-11-29T01:00:00Z");
    expect(othersWait(false, later - 60_000, later)).toBe(false);
  });

  it("keeps a waiting move in the watch's view until its turn, and says how long", () => {
    expect(watchWindowMs(now)).toBeGreaterThan(6 * 3600_000);
    expect(watchWindowMs(Date.parse("2026-11-23T20:00:00Z"))).toBeGreaterThan(90 * 60_000);
    expect(othersWithinMinutes(now)).toBe(360);
    expect(othersWithinMinutes(Date.parse("2026-11-23T00:00:00Z"))).toBe(90);
    expect(othersWithinMinutes(Date.parse("2026-11-30T00:00:00Z"))).toBe(30);
  });
});
