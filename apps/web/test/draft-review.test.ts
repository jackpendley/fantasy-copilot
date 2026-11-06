import { describe, expect, it } from "vitest";
import type { DraftPick, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import {
  draftAccuracy,
  hindsightDraft,
  matchRankings,
  parseRankingsCsv,
} from "@/lib/nba/draft-review";
import { valueContext } from "@/lib/nba/trade";

// Synthetic rankings, players and draft (not real data).
const CSV = [
  "rank,name,team,pos,eligible,tier,value,fppg,espnAdp",
  '1,"Player, Alpha",AAA,C,C,1,100,50.5,1.2',
  "2,Beta Jr.,BBB,PG,PG,1,90,45,2",
  "3,Gamma,CCC,SG,SG,2,80,not-a-number,3",
  "",
].join("\n");

describe("draft rankings", () => {
  it("parses the CSV, quoted names included, and skips broken rows", () => {
    const rows = parseRankingsCsv(CSV);
    expect(rows.map((r) => r.name)).toEqual(["Player, Alpha", "Beta Jr."]);
    expect(rows[0]).toMatchObject({ rank: 1, team: "AAA", tier: 1, value: 100, fppg: 50.5 });
    expect(() => parseRankingsCsv("a,b\n1,2")).toThrow(/rank, name and fppg/);
  });

  it("matches ESPN players by name, the team breaking a tie", () => {
    const rows = parseRankingsCsv(CSV);
    const { matched, unmatched } = matchRankings(
      [...rows, { rank: 9, name: "Nobody", team: "X", tier: 3, value: 0, fppg: 1 }],
      [
        { id: 10, name: "Player, Alpha", proTeam: "ZZZ" },
        { id: 11, name: "Player, Alpha", proTeam: "AAA" },
        { id: 12, name: "Beta", proTeam: "BBB" }, // "Jr." doesn't stop the match
      ],
    );
    expect(matched.map((m) => [m.name, m.playerId])).toEqual([
      ["Player, Alpha", 11],
      ["Beta Jr.", 12],
    ]);
    expect(unmatched.map((u) => u.name)).toEqual(["Nobody"]);
  });

  it("measures our projection's error against the simple baseline", () => {
    const a = draftAccuracy([
      { playerId: 1, name: "A", pre: 40, actual: 50, games: 12, lastSeason: 48 },
      { playerId: 2, name: "B", pre: 30, actual: 20, games: 15, lastSeason: null },
      { playerId: 3, name: "C", pre: 30, actual: 10, games: 4, lastSeason: 30 }, // too few games
    ])!;
    expect(a.n).toBe(2);
    expect(a.mae).toBe(10);
    expect(a.baseline).toEqual({ n: 1, mae: 2, oursOnSame: 10 });
    expect(a.over.map((m) => m.playerId)).toEqual([1]);
    expect(a.under.map((m) => m.playerId)).toEqual([2]);
  });
});

describe("the hindsight draft", () => {
  // Every pro team plays every day 1-20; one C and one PG start.
  const games: ProGame[] = [];
  for (let day = 1; day <= 20; day++)
    for (let t = 1; t <= 9; t++)
      games.push({
        gameId: day * 100 + t,
        scoringPeriodId: day,
        date: 0,
        homeProTeamId: t,
        awayProTeamId: t + 20,
      });
  const ctx = valueContext(games, { C: 1, PG: 1, BE: 1 }, 1, 20, 3);
  const p = (id: number, pos: string, fppg: number): RosterPlayer =>
    ({
      id,
      name: `P${id}`,
      proTeamId: id,
      proTeam: "X",
      positions: [pos],
      slot: null,
      injuryStatus: "ACTIVE",
      projection: { avg: fppg, total: fppg * 82, stats: {} },
      season: { avg: fppg, total: fppg * 10, stats: { GP: 10 } },
      last7: null,
      last15: null,
      last30: null,
    }) as unknown as RosterPlayer;
  const players = new Map(
    [
      p(1, "C", 50),
      p(2, "C", 45),
      p(3, "PG", 30),
      p(4, "C", 40),
      p(5, "PG", 25),
      p(6, "PG", 10),
    ].map((x) => [x.id, x]),
  );
  const pick = (overall: number, teamId: number, playerId: number): DraftPick => ({
    overall,
    round: Math.ceil(overall / 2),
    teamId,
    playerId,
    keeper: false,
  });
  // Jack (team 1) took two centers and a weak guard; team 2's picks stay fixed.
  const order = [
    pick(1, 1, 2),
    pick(2, 2, 1),
    pick(3, 2, 3),
    pick(4, 1, 4),
    pick(5, 1, 6),
    pick(6, 2, 5),
  ];
  const soFar = (x: RosterPlayer) => x.season?.total ?? 0;

  it("keeps others' picks, fills the lineup, and beats the real draft", () => {
    const h = hindsightDraft(order, 1, players, ctx, soFar, (x) => soFar(x) + x.season!.avg! * 20)!;
    expect(h.actual.map((x) => x.playerId)).toEqual([2, 4, 6]);
    // Pick 1: the best player (team 2's pick of him is left empty); pick 4: a guard, since only
    // one C starts (team 2's guard, 3, is gone by then); pick 5: the best left, the 45-point C
    // the real draft took first.
    expect(h.hindsight.map((x) => x.playerId)).toEqual([1, 5, 2]);
    expect(h.hindsightValue).toBeGreaterThan(h.actualValue);
  });

  it("returns nothing for a team that didn't draft", () => {
    expect(hindsightDraft(order, 9, players, ctx, soFar, soFar)).toBeNull();
  });
});
