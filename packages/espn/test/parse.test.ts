import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchLeague,
  parseFreeAgents,
  parseMatchups,
  parseProSchedule,
  parseSettings,
  parseTeams,
} from "../src/index";

// Trimmed from a real 2026-27 league response; team and owner names replaced.
const league = JSON.parse(readFileSync(new URL("./fixtures/league.json", import.meta.url), "utf8"));
const pro = JSON.parse(
  readFileSync(new URL("./fixtures/pro-schedule.json", import.meta.url), "utf8"),
);

describe("parseSettings", () => {
  const s = parseSettings(league);
  it("reads the lineup slots", () => {
    expect(s.slotCounts).toEqual({
      PG: 1,
      SG: 1,
      SF: 1,
      PF: 1,
      C: 1,
      G: 1,
      F: 1,
      UTIL: 2,
      BE: 3,
      IR: 1,
    });
    expect(s.benchUnlimited).toBe(true);
    expect(s.lineupLock).toBe("INDIVIDUAL_GAME");
  });
  it("reads the league's scoring", () => {
    expect(s.scoring).toMatchObject({
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
      DD: 5,
      TD: 15,
      QD: 25,
    });
  });
  it("converts the per-day add limit to adds per week", () => {
    expect(s.addsPerWeek).toBe(3);
    expect(s.regularSeasonWeeks).toBe(19);
    expect(s.playoffTeams).toBe(6);
  });
});

describe("parseTeams", () => {
  const teams = parseTeams(league);
  const mine = teams.find((t) => t.id === 13)!;
  it("parses rosters with slots, positions and projections", () => {
    expect(mine.roster).toHaveLength(12);
    const tatum = mine.roster.find((p) => p.name === "Jayson Tatum")!;
    expect(tatum).toMatchObject({ proTeam: "BOS", slot: "PF" });
    expect(tatum.positions).toEqual(["SF", "PF"]);
    expect(tatum.projection?.avg).toBeGreaterThan(30);
    expect(tatum.projection?.stats.FGM).toBeGreaterThan(5);
  });
  it("reads activity counters when present", () => {
    expect(mine.activity).toBeNull(); // the anonymized fixture has no transactionCounter
    const withCounter = parseTeams({
      seasonId: 2027,
      teams: [{ id: 1, transactionCounter: { moveToActive: 12, acquisitions: 2 } }],
    });
    expect(withCounter[0]!.activity).toEqual({ lineupMoves: 12, adds: 2, addsByPeriod: {} });
    const weekly = parseTeams({
      seasonId: 2027,
      teams: [{ id: 1, transactionCounter: { matchupAcquisitionTotals: { "3": 2 } } }],
    });
    expect(weekly[0]!.activity!.addsByPeriod).toEqual({ 3: 2 });
  });
  it("names bench players' slot", () => {
    expect(mine.roster.filter((p) => p.slot === "BE")).toHaveLength(3);
  });
  it("takes health from the player record, not the roster entry's slot status", () => {
    // Synthetic: ESPN's entry says NORMAL / FUTURE_TO_IR; the player record has the injury.
    const [t] = parseTeams({
      seasonId: 2027,
      teams: [
        {
          id: 1,
          roster: {
            entries: [
              {
                lineupSlotId: 12,
                injuryStatus: "FUTURE_TO_IR",
                playerPoolEntry: { player: { id: 1, fullName: "A", injuryStatus: "OUT" } },
              },
              {
                lineupSlotId: 12,
                injuryStatus: "NORMAL",
                playerPoolEntry: { player: { id: 2, fullName: "B", injuryStatus: "DAY_TO_DAY" } },
              },
              {
                lineupSlotId: 0,
                injuryStatus: "NORMAL",
                playerPoolEntry: { player: { id: 3, fullName: "C" } },
              },
            ],
          },
        },
      ],
    });
    expect(t!.roster.map((p) => [p.injuryStatus, p.pendingIR])).toEqual([
      ["OUT", true],
      ["DAY_TO_DAY", false],
      [null, false],
    ]);
  });
});

describe("parseFreeAgents", () => {
  it("keeps free agents and waiver players with their status and ownership trend", () => {
    // Synthetic response in kona_player_info's shape.
    const fa = parseFreeAgents(
      {
        players: [
          {
            status: "WAIVERS",
            waiverProcessDate: 1792479600000,
            player: {
              id: 1,
              fullName: "A",
              proTeamId: 2,
              eligibleSlots: [0, 1],
              ownership: { percentOwned: 50, percentChange: 3.2 },
            },
          },
          {
            status: "FREEAGENT",
            player: { id: 2, fullName: "B", proTeamId: 3, eligibleSlots: [4] },
          },
          { status: "ONTEAM", player: { id: 3, fullName: "C", proTeamId: 3, eligibleSlots: [4] } },
        ],
      },
      2027,
    );
    expect(fa.map((f) => [f.player.name, f.status, f.waiverUntil])).toEqual([
      ["A", "WAIVERS", 1792479600000],
      ["B", "FREEAGENT", null],
    ]);
    expect(fa[0]!.player.percentChange).toBe(3.2);
    expect(fa[0]!.player.positions).toEqual(["PG", "SG"]);
  });
});

describe("parseMatchups", () => {
  it("keeps byes and both weeks", () => {
    const m = parseMatchups(league);
    expect(new Set(m.map((x) => x.period))).toEqual(new Set([1, 2]));
    expect(m.find((x) => x.homeTeamId === 13 || x.awayTeamId === 13)).toBeTruthy();
  });
});

describe("parseProSchedule", () => {
  it("dedupes games seen from both teams and sorts by tip time", () => {
    const games = parseProSchedule(pro);
    expect(games.length).toBeGreaterThan(0);
    expect(new Set(games.map((g) => g.gameId)).size).toBe(games.length);
    for (let i = 1; i < games.length; i++)
      expect(games[i]!.date).toBeGreaterThanOrEqual(games[i - 1]!.date);
  });
});

describe("fetchLeague", () => {
  it("sends cookies, views and the filter header", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await fetchLeague(
      { s2: "S2", swid: "{SW}", leagueId: 1, season: 2027 },
      ["mRoster", "mSettings"],
      {
        filter: { players: { limit: 1 } },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(
      "/games/fba/seasons/2027/segments/0/leagues/1?view=mRoster&view=mSettings",
    );
    expect((init.headers as Record<string, string>).Cookie).toBe("espn_s2=S2; SWID={SW}");
    expect((init.headers as Record<string, string>)["X-Fantasy-Filter"]).toBe(
      '{"players":{"limit":1}}',
    );
  });
  it("explains a 401", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    await expect(
      fetchLeague({ s2: "", swid: "", leagueId: 1, season: 2027 }, ["mTeam"], {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow(/cookies/);
  });
});
