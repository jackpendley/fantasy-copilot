import { describe, expect, it } from "vitest";
import { parseOnCourt } from "../src/espn-site";

// Synthetic summary (not real data): one team, two starters, one bench player.
const athlete = (id: string, starter: boolean) => ({ athlete: { id }, starter });
const summary = (subs: [string, string][]) => ({
  boxscore: {
    players: [
      {
        team: { id: "1" },
        statistics: [
          { athletes: [athlete("10", true), athlete("11", true), athlete("12", false)] },
        ],
      },
    ],
  },
  plays: subs.map(([enters, leaves]) => ({
    type: { text: "Substitution" },
    team: { id: "1" },
    participants: [{ athlete: { id: enters } }, { athlete: { id: leaves } }],
  })),
});

describe("parseOnCourt", () => {
  it("starts from the starters and follows each substitution", () => {
    expect([...parseOnCourt(summary([]))]).toEqual([
      [10, true],
      [11, true],
      [12, false],
    ]);
    const after = parseOnCourt(summary([["12", "10"]]));
    expect(after.get(10)).toBe(false);
    expect(after.get(12)).toBe(true);
    const back = parseOnCourt(
      summary([
        ["12", "10"],
        ["10", "11"],
      ]),
    );
    expect([back.get(10), back.get(11), back.get(12)]).toEqual([true, false, true]);
  });
});
