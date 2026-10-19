import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMatcher,
  normalizeName,
  parseDailyLineups,
  parseInjuries,
  parseScoreboard,
  toEspnTeam,
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
