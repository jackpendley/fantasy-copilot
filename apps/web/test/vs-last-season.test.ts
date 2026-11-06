import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import {
  parseSeasonTotals,
  pickBaseline,
  ratesOf,
  vsLastSeason,
  type SeasonLine,
} from "@/lib/nba/vs-last-season";

// Synthetic players and seasons (not real data). Scoring: 1 per point-producing make, -1 per miss.
const SCORING = { FGM: 2, FGMI: -1, REB: 1, AST: 1 };
const line = (id: number, gp: number, perGame: Record<string, number>): SeasonLine => ({
  id,
  name: `P${id}`,
  gp,
  totals: Object.fromEntries(Object.entries(perGame).map(([k, v]) => [k, v * gp])),
});
const now = (id: number, avg: number, gp: number, min: number): { player: RosterPlayer } => ({
  player: {
    id,
    name: `P${id}`,
    proTeamId: 1,
    proTeam: "X",
    positions: ["PG"],
    slot: null,
    injuryStatus: "ACTIVE",
    percentOwned: 0,
    percentChange: 0,
    projection: null,
    season: { avg, total: avg * gp, stats: { GP: gp, MIN: min, PTS: 20, FGA: 15, FTA: 5 } },
    last7: null,
    last15: null,
    last30: null,
  } as unknown as RosterPlayer,
});

describe("vs last season", () => {
  it("reads season totals (actual, full season) and fills in misses", () => {
    const raw = {
      players: [
        {
          player: {
            id: 7,
            fullName: "P7",
            stats: [
              // GP 42, MIN 40, FGM 13, FGA 0... (ESPN ids: 13 FGM, 14 FGA)
              {
                statSourceId: 0,
                statSplitTypeId: 0,
                seasonId: 2026,
                stats: { 42: 10, 40: 300, 13: 50, 14: 110, 19: 0.45 },
              },
              { statSourceId: 1, statSplitTypeId: 0, seasonId: 2026, stats: { 42: 82 } }, // projection
            ],
          },
        },
        { player: { id: 8, fullName: "P8", stats: [] } },
      ],
    };
    const [p] = parseSeasonTotals(raw, 2026);
    expect(parseSeasonTotals(raw, 2026)).toHaveLength(1);
    expect(p!.gp).toBe(10);
    expect(p!.totals.FGMI).toBe(60);
    expect(p!.totals["FG%"]).toBeUndefined(); // rates don't add up
    const r = ratesOf(p!, 2026, SCORING);
    expect(r.fppg).toBeCloseTo((50 * 2 - 60) / 10, 6);
    expect(r.minutes).toBe(30);
  });

  it("compares with the most recent season of 40+ games, looking back two", () => {
    const seasons = [
      {
        season: 2026,
        lines: new Map([
          [1, line(1, 20, { REB: 5 })],
          [2, line(2, 60, { REB: 5 })],
        ]),
      },
      { season: 2025, lines: new Map([[1, line(1, 70, { REB: 8 })]]) },
    ];
    expect(pickBaseline(1, seasons)?.season).toBe(2025); // 2026 too short
    expect(pickBaseline(2, seasons)?.season).toBe(2026);
    expect(pickBaseline(3, seasons)).toBeNull();
  });

  it("ranks risers and fallers, needs 5 games now, and flags a role change", () => {
    const seasons = [
      {
        season: 2026,
        lines: new Map([
          [1, line(1, 60, { REB: 20, MIN: 24 })],
          [2, line(2, 60, { REB: 30, MIN: 34 })],
          [3, line(3, 60, { REB: 10, MIN: 20 })],
        ]),
      },
    ];
    const res = vsLastSeason(
      [now(1, 30, 8, 32), now(2, 25, 8, 33), now(3, 40, 3, 30)],
      seasons,
      SCORING,
      2027,
    );
    expect(res.risers.map((r) => r.entry.player.id)).toEqual([1]); // 3 has only 3 games
    expect(res.risers[0]!.delta).toBeCloseTo(10, 6);
    expect(res.risers[0]!.role).toBe("bigger"); // 24 -> 32 minutes
    expect(res.fallers.map((r) => r.entry.player.id)).toEqual([2]);
    expect(res.fallers[0]!.role).toBeNull();
  });
});
