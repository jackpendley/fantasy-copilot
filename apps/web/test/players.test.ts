import { describe, expect, it } from "vitest";
import type { FreeAgent, RosterPlayer } from "@fantasy-copilot/espn";
import type { GameLogEntry } from "@fantasy-copilot/nba-data";
import { scoreGames, summarize } from "@/lib/nba/player";
import { hotAndCold, injuryOpenings, ownershipRisers } from "@/lib/nba/trends";

const SCORING = {
  FGM: 2,
  FGMI: -2,
  FTM: 1,
  FTMI: -1,
  "3PM": 2.5,
  REB: 1.5,
  AST: 2,
  STL: 4,
  BLK: 4,
  TO: -2,
};

// Synthetic games and players (not real data).
const game = (
  i: number,
  line: Record<string, number>,
  part: GameLogEntry["part"] = "regular",
): GameLogEntry => ({
  gameId: i,
  date: `2026-10-${String(20 + i).padStart(2, "0")}T23:00:00Z`,
  opponent: "BOS",
  home: true,
  result: "W",
  score: "",
  part,
  line,
});
const player = (
  id: number,
  name: string,
  pro: number,
  positions: string[],
  proj: number,
  extra: Partial<RosterPlayer> = {},
): RosterPlayer => ({
  id,
  name,
  proTeamId: pro,
  proTeam: "X",
  positions,
  slot: null,
  injuryStatus: "ACTIVE",
  percentOwned: 20,
  percentChange: 0,
  projection: { avg: proj, total: proj * 70, stats: {} },
  season: null,
  last7: null,
  last15: null,
  last30: null,
  ...extra,
});

describe("scoreGames / summarize", () => {
  const base = {
    MIN: 30,
    FGM: 5,
    FGA: 10,
    FTM: 2,
    FTA: 2,
    "3PM": 1,
    "3PA": 3,
    REB: 6,
    AST: 4,
    STL: 1,
    BLK: 0,
    TO: 2,
    PTS: 13,
  };
  // 10 - 10 + 2 + 2.5 + 9 + 8 + 4 - 4 = 21.5
  const games = [
    game(0, { ...base, MIN: 20 }, "pre"),
    ...[1, 2, 3, 4, 5, 6].map((i) => game(i, base)),
  ];

  it("scores with league rules and skips preseason", () => {
    const rows = scoreGames(games, SCORING);
    expect(rows).toHaveLength(6);
    expect(rows[0]!.fp).toBeCloseTo(21.5, 6);
  });
  it("starts the rolling average once there are enough games", () => {
    const rows = scoreGames(games, SCORING, 5);
    expect(rows[3]!.rolling).toBeNull();
    expect(rows[4]!.rolling).toBeCloseTo(21.5, 6);
  });
  it("summarizes games, last 5 and minutes", () => {
    const s = summarize(scoreGames(games, SCORING));
    expect(s).toMatchObject({ games: 6, minutes: 30, minutesLast5: 30 });
    expect(s.fppg).toBeCloseTo(21.5, 6);
  });
  it("keeps playoff games out of season averages but in last 5", () => {
    const withPlayoff = [...games, game(7, { ...base, MIN: 40, PTS: 30 }, "post")];
    const s = summarize(scoreGames(withPlayoff, SCORING));
    expect(s).toMatchObject({ games: 6, minutes: 30, minutesLast5: 32 });
  });
});

describe("trends", () => {
  const hot = player(1, "Hot", 1, ["PG"], 20, { last7: { avg: 35, total: 105, stats: {} } });
  const cold = player(2, "Cold", 1, ["C"], 40, { last7: { avg: 22, total: 66, stats: {} } });
  const rookie = player(3, "One Game", 1, ["SF"], 15, { last7: { avg: 50, total: 50, stats: {} } });
  const pool = [hot, cold, rookie].map((p) => ({
    player: p,
    owner: "Free agent",
    mine: false,
    available: true,
  }));

  it("ranks hot and cold against projection, ignoring tiny samples", () => {
    const r = hotAndCold(pool);
    expect(r.hot.map((x) => x.entry.player.name)).toEqual(["Hot"]);
    expect(r.cold.map((x) => x.entry.player.name)).toEqual(["Cold"]);
  });

  it("lists ownership risers among free agents", () => {
    const fa = (p: RosterPlayer, chg: number): FreeAgent => ({
      player: { ...p, percentChange: chg },
      status: "FREEAGENT",
      waiverUntil: null,
    });
    expect(
      ownershipRisers([fa(hot, 1), fa(cold, 5), fa(rookie, -2)]).map((f) => f.player.name),
    ).toEqual(["Cold", "Hot"]);
  });

  it("finds free agents who share a position group with an injured star on their team", () => {
    const star = player(10, "Star C", 7, ["C"], 45, { injuryStatus: "OUT" });
    const backupC = player(11, "Backup C", 7, ["PF", "C"], 18);
    const guard = player(12, "Guard", 7, ["PG"], 22);
    const elsewhere = player(13, "Other C", 8, ["C"], 25);
    const fas: FreeAgent[] = [backupC, guard, elsewhere].map((p) => ({
      player: p,
      status: "FREEAGENT",
      waiverUntil: null,
    }));
    const star2 = player(14, "Star F", 7, ["SF"], 35, { injuryStatus: "OUT" });
    const wing = player(15, "Backup F", 7, ["SF"], 16);
    const openings = injuryOpenings(
      [star, star2],
      [],
      [...fas, { player: wing, status: "FREEAGENT", waiverUntil: null }],
    );
    // One opening per NBA team, covering both stars' position groups.
    expect(openings).toHaveLength(1);
    expect(openings[0]!.outs.map((o) => o.player.name)).toEqual(["Star C", "Star F"]);
    expect(openings[0]!.beneficiaries.map((f) => f.player.name)).toEqual(["Backup C", "Backup F"]);
  });
});
