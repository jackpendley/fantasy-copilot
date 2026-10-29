import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMatcher,
  normalizeName,
  parseDailyLineups,
  parseGameLog,
  parseInjuries,
  parseScoreboard,
  toEspnTeam,
  parseBoxScore,
} from "../src/index";

const fixture = (f: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));

describe("parseScoreboard", () => {
  it("reads a scheduled game with tip time, teams and the line", () => {
    const [g] = parseScoreboard(fixture("scoreboard-pre.json"));
    expect(g).toMatchObject({
      gameId: 401909088,
      state: "pre",
      homeTeamId: 8,
      awayTeamId: 2,
      homeScore: null,
    });
    expect(new Date(g!.tip).toISOString()).toBe("2026-10-20T19:00:00.000Z");
  });
  it("reads final scores", () => {
    const games = parseScoreboard(fixture("scoreboard-final.json"));
    expect(games.every((g) => g.state === "post" && g.homeScore! > 0 && g.awayScore! > 0)).toBe(
      true,
    );
  });
});

describe("parseInjuries", () => {
  it("keeps ESPN's estimated return date and injury type (synthetic entry)", () => {
    const [r] = parseInjuries({
      injuries: [
        {
          id: "8",
          injuries: [
            {
              athlete: { id: "11", displayName: "A" },
              status: "Out",
              shortComment: "Re-evaluated in two weeks.",
              date: "2026-10-25T14:56Z",
              details: { type: "Hamstring", detail: "Strain", returnDate: "2026-11-09" },
            },
          ],
        },
      ],
    });
    expect(r).toMatchObject({
      playerId: 11,
      returnDate: "2026-11-09",
      injury: "Hamstring / Strain",
    });
  });
  it("extracts ESPN player ids, status and notes", () => {
    const rows = parseInjuries(fixture("injuries.json"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.playerId).toBeGreaterThan(0);
      expect(r.status).not.toBe("");
    }
  });
});

describe("parseDailyLineups", () => {
  const rows = parseDailyLineups(fixture("daily-lineups.json"));
  it("marks exactly five starters per team", () => {
    const starters: Record<string, number> = {};
    for (const r of rows) if (r.starter) starters[r.team] = (starters[r.team] ?? 0) + 1;
    expect(Object.values(starters)).toEqual([5, 5]);
  });
  it("keeps inactive players", () => {
    expect(rows.some((r) => r.rosterStatus === "Inactive" && !r.starter)).toBe(true);
  });
});

describe("names", () => {
  it("normalizes accents, punctuation and suffixes", () => {
    expect(normalizeName("Nikola Jokić")).toBe("nikola jokic");
    expect(normalizeName("Jaren Jackson Jr.")).toBe("jaren jackson");
    expect(normalizeName("De'Aaron Fox")).toBe("deaaron fox");
  });
  it("matches by name + team, then a unique name, else null", () => {
    const match = buildMatcher([
      { id: 1, name: "Jalen Williams", team: "OKC" },
      { id: 2, name: "Jalen Williams", team: "SA" },
      { id: 3, name: "Kon Knueppel", team: "CHA" },
    ]);
    expect(match("Jalen Williams", "OKC")).toBe(1);
    expect(match("Jalen Williams", "DEN")).toBeNull();
    expect(match("Kon Knueppel", "MIA")).toBe(3);
    expect(toEspnTeam("GSW")).toBe("GS");
  });
});

describe("parseGameLog", () => {
  const log = parseGameLog(fixture("gamelog.json"));
  it("parses regular-season and preseason games, oldest first", () => {
    expect(log.length).toBeGreaterThan(10);
    for (let i = 1; i < log.length; i++)
      expect(Date.parse(log[i]!.date)).toBeGreaterThanOrEqual(Date.parse(log[i - 1]!.date));
    expect(new Set(log.map((g) => g.part))).toEqual(new Set(["regular", "pre"]));
  });
  it("splits made-attempted pairs into league stat names", () => {
    const g = log.find((x) => x.part === "regular")!;
    expect(Object.keys(g.line).sort()).toEqual(
      [
        "3PA",
        "3PM",
        "AST",
        "BLK",
        "FGA",
        "FGM",
        "FTA",
        "FTM",
        "MIN",
        "PF",
        "PTS",
        "REB",
        "STL",
        "TO",
      ].sort(),
    );
    expect(g.line.FGA).toBeGreaterThanOrEqual(g.line.FGM!);
    // Points add up from the makes.
    expect(g.line.PTS).toBe(2 * g.line.FGM! + g.line["3PM"]! + g.line.FTM!);
    expect(g.opponent).toMatch(/^[A-Z]{2,4}$/);
  });
});

describe("parseBoxScore", () => {
  it("reads every player who played (synthetic summary)", () => {
    const rows = parseBoxScore({
      boxscore: {
        players: [
          {
            team: { id: "2" },
            statistics: [
              {
                names: ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "PF"],
                athletes: [
                  {
                    athlete: { id: "11" },
                    stats: ["31", "38", "12-21", "7-12", "7-8", "5", "3", "3", "5", "0", "2"],
                  },
                  { athlete: { id: "12" }, didNotPlay: true, stats: [] },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(rows).toEqual([
      {
        playerId: 11,
        teamId: 2,
        line: {
          MIN: 31,
          PTS: 38,
          FGM: 12,
          FGA: 21,
          "3PM": 7,
          "3PA": 12,
          FTM: 7,
          FTA: 8,
          REB: 5,
          AST: 3,
          TO: 3,
          STL: 5,
          BLK: 0,
          PF: 2,
        },
      },
    ]);
  });
});
