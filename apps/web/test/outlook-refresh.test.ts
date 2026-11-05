import { describe, expect, it } from "vitest";
import { othersWait } from "@/lib/nba/outlook-refresh";

describe("other teams' moves wait for the 30-minute gap (until Nov 20)", () => {
  const now = Date.parse("2026-11-08T20:00:00Z");
  it("waits when the last job is recent, unless the move is Jack's own", () => {
    expect(othersWait(false, now - 10 * 60_000, now)).toBe(true);
    expect(othersWait(true, now - 10 * 60_000, now)).toBe(false);
    expect(othersWait(false, now - 31 * 60_000, now)).toBe(false);
    expect(othersWait(false, null, now)).toBe(false);
  });
  it("stops on Nov 20", () => {
    const later = Date.parse("2026-11-20T01:00:00Z");
    expect(othersWait(false, later - 60_000, later)).toBe(false);
  });
});
