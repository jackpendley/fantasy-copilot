import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseSettings,
  parseTeams,
  type FreeAgent,
  type ProGame,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import { waiverAnalysis } from "@/lib/nba/waivers";

// Anonymized league fixture (team 13's roster); free agents and games are synthetic.
const league = JSON.parse(
  readFileSync(
    new URL("../../../packages/espn/test/fixtures/league.json", import.meta.url),
    "utf8",
  ),
);
const settings = parseSettings(league);
const roster = parseTeams(league).find((t) => t.id === 13)!.roster;

function fa(
  id: number,
  name: string,
  proTeamId: number,
  fppg: number,
  positions: string[],
  status: FreeAgent["status"] = "FREEAGENT",
  waiverUntil: number | null = null,
): FreeAgent {
  const player: RosterPlayer = {
    id,
    name,
    proTeamId,
    proTeam: "X",
    positions,
    slot: null,
    injuryStatus: "ACTIVE",
    percentOwned: 10,
    percentChange: 1,
    projection: { avg: fppg, total: fppg * 70, stats: {} },
    season: null,
    last7: null,
    last15: null,
    last30: null,
  };
  return { player, status, waiverUntil };
}

// Week 1 (days 1-6). Team 99 (synthetic) plays every day; team 98 never this week.
const games: ProGame[] = [];
for (let d = 1; d <= 6; d++)
  games.push({
    gameId: 1000 + d,
    scoringPeriodId: d,
    date: Date.parse(`2026-10-${19 + d}T23:00:00Z`),
    homeProTeamId: 99,
    awayProTeamId: 97,
  });
// Team 98 plays five games after this week (rest-of-season value).
for (let k = 0; k < 5; k++)
  games.push({
    gameId: 2000 + k,
    scoringPeriodId: 30 + k * 2,
    date: Date.parse("2026-11-18T23:00:00Z") + k * 2 * 86_400_000,
    homeProTeamId: 98,
    awayProTeamId: 96,
  });

const base = {
  roster,
  week: {
    periods: [1, 2, 3, 4, 5, 6],
    fromPeriod: 1,
    games,
    slotCounts: settings.slotCounts,
    injuries: [],
  },
  myBanked: 0,
  oppBanked: 0,
  myRemaining: 900,
  oppRemaining: 900,
  lockedToday: new Set<number>(),
  startedToday: new Set<number>(),
  rosterLimit: 12,
  lastDay: 160,
};

describe("waiverAnalysis", () => {
  it("ranks a guard who plays every open day above one with no games this week", () => {
    const res = waiverAnalysis({
      ...base,
      freeAgents: [fa(1, "Daily Guard", 99, 22, ["PG", "SG"]), fa(2, "Idle Big", 98, 30, ["C"])],
    });
    const top = res.thisWeek[0]!;
    expect(top.add.player.name).toBe("Daily Guard");
    expect(top.deltaStarts).toBeGreaterThan(0);
    expect(top.deltaPts).toBeGreaterThan(0);
    expect(top.deltaWin!).toBeGreaterThan(0);
    expect(top.drop).not.toBeNull(); // full roster: someone must go
    // The idle big can't help this week, so he's only a long-term option (if any).
    expect(res.thisWeek.some((o) => o.add.player.name === "Idle Big")).toBe(false);
  });

  it("keeps weekly losers out of this week's list but offers season value separately", () => {
    // A strong player with no games this week: hurts the week, adds season value.
    const res = waiverAnalysis({ ...base, freeAgents: [fa(2, "Idle Star", 98, 45, ["C"])] });
    expect(res.thisWeek).toHaveLength(0);
    const lt = res.longTerm[0]!;
    expect(lt.add.player.name).toBe("Idle Star");
    expect(lt.rosDelta).toBeGreaterThan(0);
  });

  it("only counts a waiver player's games after his claim processes", () => {
    const now = waiverAnalysis({ ...base, freeAgents: [fa(1, "G", 99, 22, ["PG"])] });
    const later = waiverAnalysis({
      ...base,
      freeAgents: [fa(1, "G", 99, 22, ["PG"], "WAIVERS", Date.parse("2026-10-24T07:00:00Z"))], // clears day 5
    });
    expect(now.candidates[0]!.weekGames).toBe(6);
    expect(later.candidates[0]!.weekGames).toBe(2);
    expect(later.thisWeek[0]!.deltaPts).toBeLessThan(now.thisWeek[0]!.deltaPts);
  });

  it("never drops a player whose game has started, and allows add-only with an open spot", () => {
    const locked = new Set(roster.map((p) => p.id));
    const res = waiverAnalysis({
      ...base,
      lockedToday: locked,
      rosterLimit: 13,
      freeAgents: [fa(1, "G", 99, 22, ["PG"])],
    });
    expect(res.thisWeek[0]!.drop).toBeNull();
  });
});
