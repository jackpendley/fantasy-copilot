import { describe, expect, it } from "vitest";
import { stillPending, type AskedTrade } from "@/lib/nba/asked-trades";
import { watchedFreeAgents } from "@/lib/nba/move-checks";

const spec = (partnerId: number) => ({
  partnerId,
  give: [1],
  get: [2],
  moves: {
    mine: { dropped: [], added: [], toIL: [] },
    theirs: { dropped: [], added: [], toIL: [] },
  },
});
const ask = (key: string, askedAt: string): AskedTrade => ({
  key,
  spec: spec(3),
  top: true,
  askedAt,
});

describe("asked trades", () => {
  const now = Date.parse("2026-11-10T20:00:00Z");
  it("stay until a result settles after the ask", () => {
    const list = [
      ask("a", "2026-11-10T19:00:00Z"),
      ask("b", "2026-11-10T19:00:00Z"),
      ask("c", "2026-11-10T19:00:00Z"),
    ];
    const settled = new Map([
      ["a", new Date("2026-11-10T19:30:00Z")], // after the ask: done
      ["b", new Date("2026-11-10T18:00:00Z")], // an older result: still pending
    ]);
    expect(stillPending(list, settled, now).map((a) => a.key)).toEqual(["b", "c"]);
  });
  it("are dropped after two days without a result", () => {
    expect(stillPending([ask("a", "2026-11-08T19:00:00Z")], new Map(), now)).toEqual([]);
  });
});

describe("the watch list's key", () => {
  it("counts only watched free agents (watched players on other teams cost nothing)", () => {
    const teams = [{ roster: [{ id: 1 }, { id: 2 }] }, { roster: [{ id: 3 }] }];
    expect(watchedFreeAgents([3, 4, 1, 5], teams)).toEqual([4, 5]);
  });
});
