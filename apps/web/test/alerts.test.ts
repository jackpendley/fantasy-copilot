import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSettings, parseTeams, type ProGame } from "@fantasy-copilot/espn";
import { buildDayBoard } from "@/lib/nba/day";
import { gamedayAlerts } from "@/lib/nba/alerts";
import { statusEventsFrom } from "@/lib/nba/news";

// Anonymized 2026-27 league fixture; games and injuries below are synthetic.
const league = JSON.parse(
  readFileSync(
    new URL("../../../packages/espn/test/fixtures/league.json", import.meta.url),
    "utf8",
  ),
);
const settings = parseSettings(league);
const roster = parseTeams(league).find((t) => t.id === 13)!.roster;
const id = (n: string) => roster.find((p) => p.name === n)!.id;
const injury = (name: string, status: string) => ({
  playerId: id(name),
  name,
  teamId: null,
  status,
  short: "synthetic note",
  long: "",
  date: "2026-10-20T17:00:00Z",
});

// BOS @ DET at 19:00Z (Tatum, Duren, Collins) and a later CLE game at 23:00Z (Allen).
const GAMES: ProGame[] = [
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
    date: Date.parse("2026-10-20T23:00:00Z"),
    homeProTeamId: 5,
    awayProTeamId: 20,
  },
];
const fmt = (iso: string) => iso.slice(11, 16);
const board = (injuries: ReturnType<typeof injury>[], now: Date, rosterOverride = roster) =>
  buildDayBoard({
    roster: rosterOverride,
    slotCounts: settings.slotCounts,
    games: GAMES,
    scoreboard: [],
    injuries,
    now,
  });

describe("gamedayAlerts", () => {
  it("flags a starter ruled out before his game", () => {
    const now = new Date("2026-10-20T15:00:00Z");
    const b = board([injury("Jayson Tatum", "Out")], now);
    const alerts = gamedayAlerts(b, "2026-10-20", now, fmt);
    expect(
      alerts.find((a) => a.key === `out-starter:2026-10-20:${id("Jayson Tatum")}`),
    ).toBeTruthy();
  });

  it("only nags about the lineup within 30 minutes of the next tip, with a stable key", () => {
    // Collins (DET) starts the day on the bench while his game tips at 19:00Z.
    const benched = roster.map((p) =>
      p.name === "John Collins"
        ? { ...p, slot: "BE" }
        : p.name === "Caleb Wilson"
          ? { ...p, slot: "F" }
          : p,
    );
    const early = new Date("2026-10-20T15:00:00Z");
    const close = new Date("2026-10-20T18:40:00Z");
    expect(
      gamedayAlerts(board([], early, benched), "2026-10-20", early, fmt).some((a) =>
        a.key.startsWith("lineup:"),
      ),
    ).toBe(false);
    const a1 = gamedayAlerts(board([], close, benched), "2026-10-20", close, fmt).find((a) =>
      a.key.startsWith("lineup:"),
    );
    const a2 = gamedayAlerts(board([], close, benched), "2026-10-20", close, fmt).find((a) =>
      a.key.startsWith("lineup:"),
    );
    expect(a1).toBeTruthy();
    expect(a1!.key).toBe(a2!.key);
  });

  it("names a later-tipping backup for a doubtful starter near tip", () => {
    // Later games for OKC (Hartenstein) and DAL (Lively): every big plays, so the
    // day-to-day Duren still starts and Lively waits on the bench with a later tip.
    const now = new Date("2026-10-20T18:30:00Z");
    const later: ProGame[] = [
      ...GAMES,
      {
        gameId: 3,
        scoringPeriodId: 1,
        date: Date.parse("2026-10-20T23:30:00Z"),
        homeProTeamId: 25,
        awayProTeamId: 6,
      },
    ];
    const b = buildDayBoard({
      roster,
      slotCounts: settings.slotCounts,
      games: later,
      scoreboard: [],
      injuries: [injury("Jalen Duren", "Day-To-Day")],
      now,
    });
    const h = b.hedges.find((x) => x.name === "Jalen Duren");
    expect(h?.backup?.name).toBe("Dereck Lively II");
    expect(
      gamedayAlerts(b, "2026-10-20", now, fmt).some(
        (a) => a.key === `hedge:2026-10-20:${id("Jalen Duren")}`,
      ),
    ).toBe(true);
  });
});

describe("statusEventsFrom", () => {
  it("logs rostered players' statuses per source and ignores everyone else", () => {
    const events = statusEventsFrom({
      rostered: roster,
      injuries: [
        injury("Josh Hart", "Day-To-Day"),
        { ...injury("Josh Hart", "Out"), playerId: 999 },
      ],
      lineups: [
        {
          nbaPersonId: 1,
          name: "Jalen Duren",
          team: "DET",
          gameId: "x",
          lineupStatus: "Confirmed",
          rosterStatus: "Active",
          position: "C",
          starter: true,
          timestamp: "2026-10-20T14:30:00",
        },
        {
          nbaPersonId: 2,
          name: "John Collins",
          team: "DET",
          gameId: "x",
          lineupStatus: "Confirmed",
          rosterStatus: "Inactive",
          position: "",
          starter: false,
          timestamp: null,
        },
      ],
      gameDate: "2026-10-20",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        playerId: id("Josh Hart"),
        source: "espn_injuries",
        status: "DAY_TO_DAY",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        playerId: id("Jalen Duren"),
        source: "nba_lineups",
        status: "STARTER_CONFIRMED",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        playerId: id("John Collins"),
        source: "nba_lineups",
        status: "INACTIVE",
      }),
    );
    expect(events.some((e) => e.playerId === 999)).toBe(false);
  });
});
