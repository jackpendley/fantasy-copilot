import { describe, expect, it } from "vitest";
import type { ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { absenceOf } from "@/lib/nba/availability";
import { dateForScoringPeriod } from "@/lib/nba/calendar";
import { pastOut } from "@/lib/nba/h2h";
import { toSimPlayer } from "@/lib/nba/outlook";
import { teamValue, valueContext } from "@/lib/nba/trade";
import { projectTeamWeek } from "@/lib/nba/week";

// Synthetic (not real data): an injured center out until day 4, behind him a healthy one.
// Both pro teams play every day 1-10; one C slot.
const games: ProGame[] = [];
for (let day = 1; day <= 10; day++)
  games.push({ gameId: day, scoringPeriodId: day, date: 0, homeProTeamId: 1, awayProTeamId: 2 });
const p = (id: number, team: number, fppg: number, injuryStatus = "ACTIVE"): RosterPlayer => ({
  id,
  name: `P${id}`,
  proTeamId: team,
  proTeam: "X",
  positions: ["C"],
  slot: "BE",
  injuryStatus,
  percentOwned: 0,
  percentChange: 0,
  projection: { avg: fppg, total: fppg * 70, stats: {} },
  season: null,
  last7: null,
  last15: null,
  last30: null,
  market: { adp: null, auctionAvg: 1, espnRank: null, espnAuction: null, seasonRank: null },
});
const hurt = p(1, 1, 40, "OUT");
const backup = p(2, 2, 20);
const report = {
  playerId: 1,
  name: "P1",
  teamId: 1,
  status: "Out",
  short: "",
  long: "",
  date: "",
  returnDate: dateForScoringPeriod(4),
};

describe("an injured player counts nothing until his estimated return, everywhere", () => {
  it("absence: out until ESPN's estimated return date", () => {
    expect(absenceOf(hurt, report, 1)?.outUntil).toBe(4);
  });

  it("this week's projection: the backup starts until he's back, then he does", () => {
    const week = projectTeamWeek([hurt, backup], {
      periods: [1, 2, 3, 4, 5, 6],
      fromPeriod: 1,
      games,
      slotCounts: { C: 1 },
      injuries: [report],
      outUntil: new Map([[1, 4]]),
    });
    for (const d of [1, 2, 3]) expect(week.startsByDay.get(d)?.has(1) ?? false).toBe(false);
    for (const d of [4, 5, 6]) expect(week.startsByDay.get(d)?.has(1)).toBe(true);
  });

  it("season value: he starts only from his return", () => {
    const ctx = valueContext(games, { C: 1, BE: 1 }, 1, 10, 1, new Map([[1, { outUntil: 4 }]]));
    const v = teamValue([hurt, backup], ctx);
    expect(v.usage.get(1)).toEqual({ games: 7, starts: 7 });
    expect(v.usage.get(2)?.starts).toBe(3);
  });

  it("season simulation: he carries his return day", () => {
    expect(toSimPlayer(hurt, 4).outUntil).toBe(4);
  });

  it("past days on the Matchup board: no projection when he was out (IR, or out and didn't play)", () => {
    expect(pastOut({ slot: "IR", points: 0, line: null }, false)).toBe(true);
    expect(pastOut({ slot: "C", points: 0, line: null }, true)).toBe(true);
    // Upgraded after an out report and played: not out.
    expect(pastOut({ slot: "C", points: 22, line: { MIN: 30 } }, true)).toBe(false);
    expect(pastOut({ slot: "C", points: 0, line: null }, false)).toBe(false);
  });
});
