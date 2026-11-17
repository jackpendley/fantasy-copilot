import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "@fantasy-copilot/espn";
import {
  SHARE,
  afterReturn,
  returnsStale,
  teammateEffects,
  withTeammateReturns,
  type LogGame,
} from "@/lib/nba/teammate-return";

// Synthetic (not real data): one pro team playing every day from scoring period 1.
const player = (id: number, pos: string, min: number, fppg: number): RosterPlayer => ({
  id,
  name: `Player ${id}`,
  proTeamId: 1,
  proTeam: "AAA",
  positions: [pos],
  defaultPosition: pos,
  slot: "BE",
  injuryStatus: "ACTIVE",
  percentOwned: 50,
  percentChange: 0,
  projection: { avg: fppg, total: fppg * 70, stats: { MIN: min } },
  season: null,
  last7: null,
  last15: null,
  last30: null,
});
const games = (sps: number[], min: (sp: number) => number, perMin = 1): LogGame[] =>
  sps.map((sp) => ({ sp, min: min(sp), fp: min(sp) * perMin }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// The regular center (30 min) plays periods 1-10 and misses 11-20; today is 21.
const star = player(1, "C", 30, 40);
const backup = player(2, "C", 15, 15);
const guard = player(3, "PG", 15, 15);
const steady = player(4, "C", 20, 20);
const schedule = new Map([[1, range(1, 20)]]);
const logs = new Map<number, LogGame[]>([
  [1, games(range(1, 10), () => 30)],
  // Minutes 15 -> 28 while he's out.
  [2, games(range(1, 20), (sp) => (sp <= 10 ? 15 : 28))],
  [3, games(range(1, 20), (sp) => (sp <= 10 ? 15 : 28))],
  // Up only 2 minutes: not a fill-in.
  [4, games(range(1, 20), (sp) => (sp <= 10 ? 20 : 22))],
]);

describe("teammate returns", () => {
  it("finds the absence and the same-position backup whose minutes rose 6+", () => {
    const effects = teammateEffects([star, backup, guard, steady], logs, schedule);
    expect(effects).toHaveLength(1);
    const e = effects[0]!;
    expect(e).toMatchObject({
      player: 2,
      teammate: 1,
      group: "C",
      from: 11,
      through: 20,
      ongoing: true,
    });
    expect(e.lambda).toBe(SHARE.C);
    expect(e.minShift).toBeCloseTo(13);
    // Today's projection carries the surge; the one from games with the star doesn't.
    expect(e.gap).toBeGreaterThan(0);
  });

  it("needs 5 straight missed games and a regular", () => {
    const short = new Map(logs).set(
      1,
      games([...range(1, 10), ...range(15, 20)], () => 30),
    );
    expect(teammateEffects([star, backup], short, schedule)).toEqual([]);
    const bench = new Map(logs).set(
      1,
      games(range(1, 10), () => 18),
    );
    expect(teammateEffects([star, backup], bench, schedule)).toEqual([]);
  });

  it("changes from the star's estimated return, from today once he's back, never for a season-long absence", () => {
    const effects = teammateEffects([star, backup], logs, schedule);
    const out = { ...star, injuryStatus: "OUT" };
    // Period 1 is Oct 20, 2026, so Nov 20 is period 32.
    const [, b] = withTeammateReturns(
      [out, backup],
      effects,
      [{ playerId: 1, status: "OUT", returnDate: "2026-11-20" }],
      21,
    );
    expect(b!.teammateReturn).toMatchObject({ day: 32, teammate: "Player 1" });
    expect(b!.teammateReturn!.shift).toBeCloseTo(-SHARE.C * effects[0]!.gap);
    const [, gone] = withTeammateReturns(
      [out, backup],
      effects,
      [{ playerId: 1, status: "OUT", returnDate: "2027-06-01" }],
      21,
    );
    expect(gone!.teammateReturn).toBeUndefined();
    // Back: he played period 21.
    const back = teammateEffects(
      [star, backup],
      new Map(logs).set(
        1,
        games([...range(1, 10), 21], () => 30),
      ),
      new Map([[1, range(1, 21)]]),
    );
    expect(back[0]!.ongoing).toBe(false);
    const [, now] = withTeammateReturns([star, backup], back, [], 22);
    expect(now!.teammateReturn!.day).toBe(22);
  });

  it("never projects below zero", () => {
    expect(afterReturn(3, { day: 1, shift: -5, teammate: "x" })).toBe(0);
    expect(afterReturn(20, { day: 1, shift: -5, teammate: "x" })).toBe(15);
  });
});

describe("teammate returns due", () => {
  it("recomputes when none are stored or they're over a day old", () => {
    const now = Date.parse("2026-11-17T22:00:00Z");
    expect(returnsStale(null, now)).toBe(true);
    expect(returnsStale(new Date("2026-11-17T11:00:00Z"), now)).toBe(false);
    expect(returnsStale(new Date("2026-11-16T11:00:00Z"), now)).toBe(true);
  });
});
