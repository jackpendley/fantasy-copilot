import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTeams, parseSettings, type ProGame } from "@fantasy-copilot/espn";
import {
  dateForScoringPeriod,
  etDate,
  matchupPeriodOf,
  scoringPeriodForDate,
  scoringPeriodsOf,
  shortDay,
} from "@/lib/nba/calendar";
import { buildDayBoard } from "@/lib/nba/day";
import { minutesTrend, perGameProjection } from "@/lib/nba/projection";
import { projectTeamWeek, winProbability } from "@/lib/nba/week";

// Anonymized 2026-27 league fixture (packages/espn): team 13's real draft-day roster.
const league = JSON.parse(
  readFileSync(
    new URL("../../../packages/espn/test/fixtures/league.json", import.meta.url),
    "utf8",
  ),
);
const settings = parseSettings(league);
const roster = parseTeams(league).find((t) => t.id === 13)!.roster;
const byName = (n: string) => roster.find((p) => p.name === n)!;

// Opening night: BOS @ DET at 19:00Z (Tatum; Duren and Collins), plus a DAL game (Lively).
const OPENING: ProGame[] = [
  {
    gameId: 1,
    scoringPeriodId: 1,
    date: Date.parse("2026-10-20T19:00:00Z"),
    homeProTeamId: 8,
    awayProTeamId: 2,
  },
  {
    gameId: 2,
    scoringPeriodId: 1,
    date: Date.parse("2026-10-21T02:30:00Z"),
    homeProTeamId: 6,
    awayProTeamId: 24,
  },
];

describe("calendar", () => {
  it("anchors scoring period 1 on Tue Oct 20 and ends the league season on Mar 28", () => {
    expect(scoringPeriodForDate("2026-10-20")).toBe(1);
    expect(dateForScoringPeriod(160)).toBe("2027-03-28");
    expect(shortDay("2026-10-20")).toBe("Tue 10/20");
  });
  it("uses the US/Eastern date (a 10:30 PM ET tip is still that day)", () => {
    expect(etDate(new Date("2026-10-21T02:30:00Z"))).toBe("2026-10-20");
  });
  it("has a 6-day week 1, Monday weeks, the Cup week 8 and a merged All-Star week", () => {
    expect(scoringPeriodsOf(1)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(dateForScoringPeriod(scoringPeriodsOf(2)[0]!)).toBe("2026-10-26"); // Monday
    expect(scoringPeriodsOf(8).map(dateForScoringPeriod)).toEqual([
      "2026-12-07",
      "2026-12-08",
      "2026-12-09",
      "2026-12-10",
      "2026-12-11",
      "2026-12-12",
      "2026-12-13",
    ]);
    const asb = scoringPeriodsOf(18);
    expect(asb).toHaveLength(14);
    expect(dateForScoringPeriod(asb[0]!)).toBe("2027-02-15");
    expect(matchupPeriodOf(160)).toBe(22);
  });
});

describe("projection", () => {
  it("uses ESPN's league-scored projection before any games", () => {
    const p = perGameProjection(byName("Jayson Tatum"));
    expect(p.source).toBe("projection");
    expect(p.fppg).toBeGreaterThan(30);
  });
});

describe("buildDayBoard", () => {
  const before = new Date("2026-10-20T18:00:00Z");
  it("starts only players with games and lists the moves", () => {
    const board = buildDayBoard({
      roster,
      slotCounts: settings.slotCounts,
      games: OPENING,
      scoreboard: [],
      injuries: [],
      now: before,
    });
    const starting = board.rows.filter(
      (r) => r.recommendedSlot !== "BE" && r.recommendedSlot !== "IR",
    );
    const withGames = board.rows.filter((r) => r.game);
    expect(withGames.map((r) => r.player.name).sort()).toEqual(
      ["Dereck Lively II", "Jalen Duren", "Jayson Tatum", "John Collins"].sort(),
    );
    for (const r of withGames) expect(starting).toContain(r);
    expect(board.optimalPoints).toBeGreaterThanOrEqual(board.currentPoints);
    expect(board.optimalPoints).toBeCloseTo(
      withGames.reduce((a, r) => a + r.value, 0),
      6,
    );
  });

  it("locks players whose game has tipped and never moves them", () => {
    const board = buildDayBoard({
      roster,
      slotCounts: settings.slotCounts,
      games: OPENING,
      scoreboard: [],
      injuries: [],
      now: new Date("2026-10-20T19:30:00Z"),
    });
    const tatum = board.rows.find((r) => r.player.name === "Jayson Tatum")!;
    expect(tatum.locked).toBe(true);
    expect(tatum.recommendedSlot).toBe(tatum.currentSlot);
    expect(board.moves.find((m) => m.name === "Jayson Tatum")).toBeUndefined();
  });

  it("zeroes a player ESPN lists as out", () => {
    const board = buildDayBoard({
      roster,
      slotCounts: settings.slotCounts,
      games: OPENING,
      scoreboard: [],
      injuries: [
        {
          playerId: byName("Jalen Duren").id,
          name: "Jalen Duren",
          teamId: 8,
          status: "Out",
          short: "Ankle",
          long: "",
          date: "",
        },
      ],
      now: before,
    });
    const duren = board.rows.find((r) => r.player.name === "Jalen Duren")!;
    expect(duren.value).toBe(0);
    expect(duren.injuryNote).toBe("Ankle");
  });
});

describe("NBA.com lineups", () => {
  // Synthetic lineup entries (not real NBA.com data) in the feed's shape.
  const entry = (name: string, team: string, starter: boolean, rosterStatus = "Active") => ({
    nbaPersonId: 1,
    name,
    team,
    gameId: "x",
    lineupStatus: "Confirmed",
    rosterStatus,
    position: starter ? "C" : "",
    starter,
    timestamp: null,
  });
  it("marks starters and zeroes inactive players", () => {
    const board = buildDayBoard({
      roster,
      slotCounts: settings.slotCounts,
      games: OPENING,
      scoreboard: [],
      injuries: [],
      lineups: [entry("Jalen Duren", "DET", true), entry("John Collins", "DET", false, "Inactive")],
      now: new Date("2026-10-20T18:00:00Z"),
    });
    const duren = board.rows.find((r) => r.player.name === "Jalen Duren")!;
    const collins = board.rows.find((r) => r.player.name === "John Collins")!;
    expect(duren.nba).toEqual({ starter: true, confirmed: true, inactive: false });
    expect(collins.value).toBe(0);
    expect(collins.status).toBe("OUT");
    expect(collins.injuryNote).toMatch(/Inactive/);
    expect(["BE", "IR"]).toContain(collins.recommendedSlot);
  });
});

describe("week", () => {
  it("projects starts only on days with games", () => {
    const wk = projectTeamWeek(roster, {
      periods: [1, 2],
      fromPeriod: 1,
      games: OPENING,
      slotCounts: settings.slotCounts,
      injuries: [],
    });
    expect(wk.startsByDay.get(1)!.size).toBe(4);
    expect(wk.startsByDay.get(2)!.size).toBe(0);
    expect(wk.remaining).toBeGreaterThan(0);
  });
  it("gives sensible win probabilities", () => {
    expect(winProbability(0, 1000, 0, 1000)).toBeCloseTo(0.5, 6);
    expect(winProbability(500, 500, 0, 900)).toBeGreaterThan(0.6);
    expect(winProbability(900, 0, 800, 0)).toBe(1);
  });
});

describe("perGameProjection as of a day", () => {
  // Synthetic: projected 30/g; 2 games played (20 and 40 points), the second on day 5.
  const p = {
    id: 1,
    name: "X",
    proTeamId: 1,
    proTeam: "X",
    positions: ["PG"],
    slot: "BE",
    injuryStatus: "ACTIVE",
    percentOwned: 0,
    percentChange: 0,
    projection: { avg: 30, total: 2100, stats: {} },
    season: { avg: 30, total: 60, stats: {} },
    last7: null,
    last15: null,
    last30: null,
    games: [
      { gameId: 1, scoringPeriodId: 3, points: 20, line: {} },
      { gameId: 2, scoringPeriodId: 5, points: 40, line: {} },
    ],
  };
  it("leaves out games from that day on", () => {
    const before = perGameProjection(p, 5);
    expect(before.gamesPlayed).toBe(1);
    // 1 game at 20 vs projection 30, shrunk with 15 prior games: (20 + 15*30) / 16
    expect(before.fppg).toBeCloseTo((20 + 15 * 30) / 16, 6);
    expect(perGameProjection(p).gamesPlayed).toBe(2);
    expect(perGameProjection(p, 3).source).toBe("projection");
  });
});

describe("minutes trend", () => {
  // Synthetic: 10 games, the last 5 at 36 minutes after 5 at 24 (a bigger role).
  const games = Array.from({ length: 10 }, (_, i) => ({
    gameId: i,
    scoringPeriodId: i + 1,
    points: 25,
    line: { MIN: i < 5 ? 24 : 36 },
  }));
  const p = {
    id: 1,
    name: "X",
    proTeamId: 1,
    proTeam: "X",
    positions: ["PG"],
    slot: "BE",
    injuryStatus: "ACTIVE",
    percentOwned: 0,
    percentChange: 0,
    projection: { avg: 25, total: 25 * 70, stats: {} },
    season: { avg: 25, total: 250, stats: {} },
    last7: null,
    last15: null,
    last30: null,
    games,
  };
  it("scales up for a rising role (half strength, clipped)", () => {
    // ratio 36 / 30 = 1.2 -> factor 1.1
    expect(minutesTrend(p)).toBeCloseTo(1.1, 6);
    expect(perGameProjection(p).fppg).toBeCloseTo(25 * 1.1, 6);
  });
  it("needs 8 games before the day, and ignores later games", () => {
    expect(minutesTrend(p, 8)).toBe(1); // only 7 games before day 8
    expect(minutesTrend({ ...p, games: games.slice(0, 5) })).toBe(1);
  });
});
