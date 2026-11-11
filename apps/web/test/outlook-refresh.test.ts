import { describe, expect, it } from "vitest";
import { othersWait, othersWithinMinutes } from "@/lib/nba/outlook-refresh";

describe("other teams' moves: minimal mode and the saver ended Nov 10 (Pro)", () => {
  const now = Date.parse("2026-11-12T20:00:00Z");
  it("never holds a move back for the nightly job or a 6-hour gap", () => {
    expect(othersWait(false, now - 10 * 60_000, now)).toBe(false);
    expect(othersWait(false, null, now)).toBe(false);
    expect(othersWait(true, now - 10 * 60_000, now)).toBe(false);
  });
  it("says a waiting move takes 30 minutes", () => {
    expect(othersWithinMinutes(now)).toBe(30);
    expect(othersWithinMinutes(Date.parse("2026-11-23T00:00:00Z"))).toBe(30);
  });
});
