import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeWire, encodeWire } from "@/lib/wire-json";
import {
  parseSettings,
  parseTeams,
  type FreeAgent,
  type ProGame,
  type RosterPlayer,
} from "@fantasy-copilot/espn";
import { valueContext } from "@/lib/nba/trade";
import { shownMoves, waiverAnalysis, type StreamOption } from "@/lib/nba/waivers";

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

  it("always evaluates watched free agents, even ones that help nobody (the Interested list)", () => {
    // 60 better guards crowd the shortlist; the watched 5-point center is still evaluated.
    const crowd = Array.from({ length: 60 }, (_, i) =>
      fa(100 + i, `Guard ${i}`, 22, 60 - i * 0.5, ["PG"]),
    );
    const watched = fa(7, "Watched Big", 30, 5, ["C"]);
    const res = waiverAnalysis({ ...base, freeAgents: [...crowd, watched], watch: new Set([7]) });
    expect(res.dropOptions.has(7)).toBe(true);
    expect(res.watched.map((o) => o.add.player.id)).toEqual([7]);
    expect(waiverAnalysis({ ...base, freeAgents: [...crowd, watched] }).dropOptions.has(7)).toBe(
      false,
    );
  });

  it("never suggests dropping a never-drop player (ADR-060)", () => {
    const freeAgents = [fa(1, "Daily Guard", 99, 22, ["PG", "SG"])];
    const open = waiverAnalysis({ ...base, freeAgents });
    const usual = open.thisWeek[0]!.drop!.id;
    const res = waiverAnalysis({ ...base, freeAgents, noDrop: new Set([usual]) });
    const drops = [...res.dropOptions.values()].flat().map((o) => o.drop?.id);
    expect(drops).not.toContain(usual);
    expect(drops.length).toBeGreaterThan(0);
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

describe("waiverAnalysis after the roster lock and with the IL", () => {
  const guard = () => fa(1, "Daily Guard", 99, 22, ["PG", "SG"]);

  it("once today's roster has locked, an add only counts from tomorrow", () => {
    const open = waiverAnalysis({ ...base, freeAgents: [guard()] });
    const locked = waiverAnalysis({ ...base, rosterLocked: true, freeAgents: [guard()] });
    expect(open.candidates[0]!.weekGames).toBe(6);
    expect(locked.candidates[0]!.weekGames).toBe(5);
    expect(locked.thisWeek[0]!.deltaPts).toBeLessThan(open.thisWeek[0]!.deltaPts);
  });

  it("after the lock, a player whose game has started can still be dropped (from tomorrow)", () => {
    const lockedToday = new Set(roster.map((p) => p.id));
    const res = waiverAnalysis({
      ...base,
      lockedToday,
      rosterLocked: true,
      freeAgents: [guard()],
    });
    expect(res.thisWeek[0]!.drop).not.toBeNull();
  });

  it("offers moving a ruled-out player to a free IL slot instead of a drop", () => {
    const hurt = roster.map((p, i) => (i === 0 ? { ...p, injuryStatus: "OUT" } : p));
    const res = waiverAnalysis({ ...base, roster: hurt, irSlots: 1, freeAgents: [guard()] });
    const top = res.thisWeek[0]!;
    expect(top.drop).toBeNull();
    expect(top.il?.id).toBe(hurt[0]!.id);
    // With the IL slot taken (or no IL), it's back to a drop.
    const full = waiverAnalysis({
      ...base,
      roster: [...hurt, { ...hurt[1]!, id: 999, slot: "IR" }],
      irSlots: 1,
      rosterLimit: 12,
      freeAgents: [guard()],
    });
    expect(full.thisWeek[0]!.il).toBeNull();
  });

  it("doesn't count a player already headed to the IL against the roster", () => {
    // Moved to IL after the lock: ESPN frees his spot tomorrow, so an add needs no drop.
    const pending = roster.map((p, i) =>
      i === 0 ? { ...p, injuryStatus: "OUT", pendingIR: true } : p,
    );
    const res = waiverAnalysis({ ...base, roster: pending, irSlots: 1, freeAgents: [guard()] });
    expect(res.thisWeek[0]!.drop).toBeNull();
    expect(res.thisWeek[0]!.il).toBeNull();
  });

  it("a player already dropped (leaving tomorrow) is never offered as the drop again", () => {
    // Synthetic: a strong guard who plays every day, dropped after today's lock.
    const leaving: RosterPlayer = { ...guard().player, id: 500, name: "Leaving", slot: "BE" };
    const res = waiverAnalysis({
      ...base,
      leaving: [leaving],
      week: { ...base.week, availableUntil: new Map([[500, 1]]) },
      freeAgents: [fa(2, "Other Guard", 99, 22, ["PG"])],
    });
    expect(res.thisWeek.length).toBeGreaterThan(0);
    expect(res.thisWeek.every((o) => o.drop?.id !== 500)).toBe(true);
  });
});

describe("waiverAnalysis by lineup fit", () => {
  // Synthetic: slots PG, C, UTIL + 2 bench; everyone plays days 1-20 (week 1 = days 1-6).
  const slots = { PG: 1, C: 1, UTIL: 1, BE: 2 };
  const daily: ProGame[] = [];
  for (let d = 1; d <= 20; d++)
    daily.push({
      gameId: 5000 + d,
      scoringPeriodId: d,
      date: 0,
      homeProTeamId: 99,
      awayProTeamId: 97,
    });
  const guy = (id: number, pos: string, fppg: number): RosterPlayer => ({
    ...fa(id, `${pos}${id}`, 99, fppg, [pos]).player,
    slot: "BE",
  });
  const roster = [
    guy(1, "C", 30),
    guy(2, "C", 28),
    guy(3, "C", 26),
    guy(4, "PG", 12),
    guy(5, "PG", 8),
  ];
  const season = valueContext(daily, slots, 1, 20, 2);
  const run = (free: FreeAgent[]) =>
    waiverAnalysis({
      ...base,
      roster,
      freeAgents: free,
      week: {
        periods: [1, 2, 3, 4, 5, 6],
        fromPeriod: 1,
        games: daily,
        slotCounts: slots,
        injuries: [],
      },
      rosterLimit: 5,
      lastDay: 20,
      season,
    });

  it("values a center who'd sit behind three others at the starts he'd actually get", () => {
    const res = run([fa(30, "Center", 99, 27, ["C"])]);
    // Raw points say +19 a game over the worst guard; on this roster he'd start only as the
    // second-best center (UTIL), pushing out the 26 and gaining ~1 point a day.
    const o = res.longTerm[0] ?? res.thisWeek[0];
    if (o) expect(o.rosDelta).toBeLessThan(0.2 * (o.add.ros - o.dropRos));
    expect(res.best.every((b) => b.add.player.id !== 30 || b.netWins < 0.05)).toBe(true);
  });

  it("prefers the guard who starts over the better-on-paper center, and drops by fit", () => {
    const res = run([fa(30, "Center", 99, 27, ["C"]), fa(31, "Guard", 99, 22, ["PG"])]);
    const top = res.best[0]!;
    expect(top.add.player.id).toBe(31);
    // He replaces the 8-point guard, who never starts; the guard starts every game.
    expect(top.drop?.id).toBe(5);
    expect(top.addUsage).toEqual({ games: 20, starts: 20 });
    expect(top.dropStarts).toBe(0);
    expect(top.netWins).toBeCloseTo((top.deltaWin ?? 0) + top.laterWins, 10);
    // "Later" shows the same playoff-weighted points its wins come from.
    expect(top.laterWins).toBeCloseTo(res.winsPerPoint * top.laterPts, 10);
    expect(top.laterPts).toBeCloseTo(top.seasonScore - top.deltaPts, 10);
  });

  it("a claim changes nothing before it processes: the dropped player plays until then", () => {
    // Clears on day 7, after this week (days 1-6): the week can't change, whatever the drop.
    const claim = fa(31, "Guard", 99, 22, ["PG"], "WAIVERS", Date.parse("2026-10-26T07:00:00Z"));
    const res = run([claim]);
    const options = res.dropOptions.get(31)!;
    expect(options.length).toBeGreaterThan(1);
    for (const o of options) {
      expect(o.deltaPts).toBe(0);
      expect(o.deltaStarts).toBe(0);
      expect(o.deltaWin).toBe(0);
    }
    // The season counts from day 7 too: the same as the move made then.
    const fromDay7 = waiverAnalysis({
      ...base,
      roster,
      freeAgents: [fa(31, "Guard", 99, 22, ["PG"])],
      week: {
        periods: [1, 2, 3, 4, 5, 6],
        fromPeriod: 1,
        games: daily,
        slotCounts: slots,
        injuries: [],
      },
      rosterLimit: 5,
      lastDay: 20,
      season: valueContext(daily, slots, 7, 20, 2),
    }).dropOptions.get(31)!;
    for (const o of options) {
      const same = fromDay7.find((x) => x.drop?.id === o.drop?.id)!;
      expect(o.seasonScore).toBeCloseTo(same.seasonScore, 10);
      expect(o.rosDelta).toBeCloseTo(same.rosDelta, 10);
    }
  });

  it("a claim for tomorrow keeps today's starter today; a free-agent move before the lock doesn't", () => {
    // Drop the 12-point guard who starts at PG: as a claim (clears day 2) he still starts day 1.
    const claim = run([
      fa(31, "Guard", 99, 22, ["PG"], "WAIVERS", Date.parse("2026-10-21T07:00:00Z")),
    ]).dropOptions.get(31)!;
    const now = run([fa(31, "Guard", 99, 22, ["PG"])]).dropOptions.get(31)!;
    const drop4 = (os: typeof claim) => os.find((o) => o.drop?.id === 4)!;
    // Immediately: the guard plays all six days for him. As a claim: days 2-6, and he plays day 1.
    expect(drop4(now).deltaStarts).toBe(0);
    expect(drop4(claim).deltaStarts).toBe(0);
    const perDay = drop4(now).deltaPts / 6;
    expect(perDay).toBeGreaterThan(0);
    expect(drop4(claim).deltaPts).toBeCloseTo(5 * perDay, 6);
  });

  it("keeps every drop for an add, best first, for swapping the drop", () => {
    const res = run([fa(31, "Guard", 99, 22, ["PG"])]);
    const options = res.dropOptions.get(31)!;
    expect(options[0]).toBe(res.best[0]);
    expect(options.length).toBeGreaterThan(1);
    expect(new Set(options.map((o) => o.drop?.id)).size).toBe(options.length);
    for (let i = 1; i < options.length; i++) {
      expect(options[i - 1]!.netWins).toBeGreaterThanOrEqual(options[i]!.netWins);
    }
  });
});

describe("the waiver analysis as a worker task", () => {
  it("gives exactly the same result from its JSON input (Maps and Sets included)", () => {
    const inputs = {
      ...base,
      freeAgents: [fa(1, "Daily Guard", 99, 22, ["PG", "SG"]), fa(2, "Idle Big", 98, 30, ["C"])],
      lockedToday: new Set([roster[0]!.id]),
      week: { ...base.week, availableFrom: new Map([[1, 2]]), outUntil: new Map([[2, 3]]) },
      season: valueContext(games, settings.slotCounts, 1, 160, 20, new Map([[2, { outUntil: 3 }]])),
    };
    const wire = JSON.parse(JSON.stringify(encodeWire(inputs)));
    const strip = (x: unknown) => JSON.parse(JSON.stringify(encodeWire(x)));
    expect(strip(waiverAnalysis(decodeWire(wire)))).toEqual(strip(waiverAnalysis(inputs)));
  });
});

describe("streams around today's first tip (rosters lock then)", () => {
  // Synthetic: slots PG, C + 1 bench; day 1 is today. Team 90 plays days 1, 3, 5; team 89 days
  // 2, 3, 4; team 88 days 1-4; team 99 every day.
  const slots = { PG: 1, C: 1, BE: 1 };
  const days = (team: number, list: number[]): ProGame[] =>
    list.map((d) => ({
      gameId: team * 100 + d,
      scoringPeriodId: d,
      date: Date.parse(`2026-10-${19 + d}T23:00:00Z`),
      homeProTeamId: team,
      awayProTeamId: 70,
    }));
  const games = [
    ...days(90, [1, 3, 5]),
    ...days(89, [2, 3, 4]),
    ...days(88, [1, 2, 3, 4]),
    ...days(99, [1, 2, 3, 4, 5, 6]),
  ];
  const guy = (id: number, team: number, pos: string, fppg: number): RosterPlayer => ({
    ...fa(id, `P${id}`, team, fppg, [pos]).player,
    slot: "BE",
  });
  const gillespie = { ...guy(1, 90, "PG", 20), name: "Gillespie" };
  const roster = [gillespie, guy(2, 99, "C", 30), guy(3, 99, "C", 28)];
  const run = (free: FreeAgent[], extra: Partial<Parameters<typeof waiverAnalysis>[0]> = {}) =>
    waiverAnalysis({
      ...base,
      roster,
      freeAgents: free,
      week: { periods: [1, 2, 3, 4, 5, 6], fromPeriod: 1, games, slotCounts: slots, injuries: [] },
      rosterLimit: 3,
      lastDay: 6,
      season: valueContext(games, slots, 1, 6, 1),
      // Only Gillespie can go (the centers are kept), as in Jack's example.
      noDrop: new Set([2, 3]),
      ...extra,
    });
  const tip = Date.parse("2026-10-20T23:00:00Z");
  const forGillespie = (r: ReturnType<typeof run>, add: number) =>
    r.dropOptions.get(add)!.find((o) => o.drop?.id === 1)!;

  it("before the tip, waits for it when that keeps the drop's game today: an extra start", () => {
    const add = fa(10, "Tomorrow Guard", 89, 20, ["PG"]); // plays days 2, 3, 4
    const now = forGillespie(run([add]), 10); // no tip known: the move counts as immediate
    const wait = forGillespie(run([add], { tips: new Map([[1, tip]]) }), 10);
    expect(now.timing).toBeUndefined();
    expect(now.deltaStarts).toBe(0); // loses Gillespie's day 1, gains day 2
    expect(wait.timing).toBe("afterTip");
    expect(wait.deltaStarts).toBe(1); // Gillespie plays today, the add from tomorrow
    expect(wait.deltaPts).toBeGreaterThan(now.deltaPts);
    expect(run([add], { tips: new Map([[1, tip]]) }).thisWeek[0]!.timing).toBe("afterTip");
  });

  it("after the tip, the same move keeps the drop today and adds from tomorrow", () => {
    const add = fa(10, "Tomorrow Guard", 89, 20, ["PG"]);
    const before = forGillespie(run([add], { tips: new Map([[1, tip]]) }), 10);
    const after = forGillespie(run([add], { rosterLocked: true }), 10);
    expect(after.deltaStarts).toBe(1);
    expect(after.deltaPts).toBeCloseTo(before.deltaPts, 6);
  });

  it("doesn't wait when the add's own game today is worth more now", () => {
    const add = fa(11, "Today Guard", 88, 25, ["PG"]); // plays days 1-4, better than Gillespie
    expect(forGillespie(run([add], { tips: new Map([[1, tip]]) }), 11).timing).toBeUndefined();
  });

  describe("after the lock, waiting for tomorrow's first tip", () => {
    // D plays days 1-4 (team 88); a move made now counts from day 2.
    const later = days(84, [3, 4, 5, 6]);
    const tomorrowTip = Date.parse("2026-10-21T23:00:00Z");
    const d = { ...guy(1, 88, "PG", 20), name: "Drop" };
    const after = (add: FreeAgent) =>
      waiverAnalysis({
        ...base,
        roster: [d, guy(2, 99, "C", 30), guy(3, 99, "C", 28)],
        freeAgents: [add],
        week: {
          periods: [1, 2, 3, 4, 5, 6],
          fromPeriod: 1,
          games: [...games, ...later],
          slotCounts: slots,
          injuries: [],
        },
        rosterLimit: 3,
        lastDay: 6,
        season: valueContext([...games, ...later], slots, 1, 6, 1),
        noDrop: new Set([2, 3]),
        rosterLocked: true,
        tips: new Map([[2, tomorrowTip]]),
      }).dropOptions.get(add.player.id)![0]!;

    it("waits when that keeps the drop's game tomorrow: an extra start", () => {
      const o = after(fa(20, "Later Guard", 84, 20, ["PG"])); // plays days 3-6, not tomorrow
      expect(o.timing).toBe("afterTip");
      expect(o.waitDay).toBe(2);
      expect(o.deltaStarts).toBe(2); // D keeps day 2; the add starts days 3-6 for D's 3-4
    });

    it("doesn't wait when the add's game tomorrow is worth more", () => {
      const o = after(fa(21, "Daily Guard", 99, 25, ["PG"])); // plays every day, better than D
      expect(o.timing).toBeUndefined();
    });

    it("never waits on a waiver claim", () => {
      const o = after(fa(22, "Claim Guard", 84, 20, ["PG"], "WAIVERS"));
      expect(o.timing).toBeUndefined();
    });
  });

  it("evaluates a cheap player who'd fill open lineup slots, whatever his volume", () => {
    // A UTIL slot stays open on days 2-6. Sixty centers who play only today (when nothing is
    // open) outrank him by fppg x games; he still gets evaluated, and streams.
    const open = { PG: 1, C: 1, UTIL: 1, BE: 1 };
    const crowd = Array.from({ length: 60 }, (_, i) =>
      fa(200 + i, `C${i}`, 87, 60 - i * 0.5, ["C"]),
    );
    const cheap = fa(12, "Cheap Forward", 99, 10, ["SF"]);
    const strong = { ...guy(4, 86, "C", 70), name: "Today Big" }; // fills UTIL today only
    const r = waiverAnalysis({
      ...base,
      roster: [gillespie, guy(2, 99, "C", 65), strong, guy(5, 85, "C", 5)],
      freeAgents: [...crowd, cheap],
      week: {
        periods: [1, 2, 3, 4, 5, 6],
        fromPeriod: 1,
        games: [...games, ...days(87, [1]), ...days(86, [1])],
        slotCounts: open,
        injuries: [],
      },
      rosterLimit: 4,
      lastDay: 6,
    });
    expect(r.dropOptions.has(12)).toBe(true);
    expect(r.thisWeek.some((o) => o.add.player.id === 12 && o.deltaStarts > 0)).toBe(true);
  });
});

describe("the streams the Moves page shows", () => {
  const o = (id: number, deltaWin: number) =>
    ({ add: { player: { id } }, drop: null, il: null, deltaWin }) as unknown as StreamOption;

  it("shows the top 5 by this week's win chance and the rest behind Show more", () => {
    const thisWeek = [o(1, 0.08), o(2, 0.07), o(3, 0.06), o(4, 0.05), o(5, 0.04), o(6, 0.03)];
    thisWeek.push(o(7, 0.02), o(8, 0.004)); // 8 barely moves it: left out
    const r = shownMoves({ best: [o(2, 0.07)], thisWeek });
    expect(r.streams.map((x) => x.add.player.id)).toEqual([1, 3, 4, 5, 6]);
    expect(r.moreStreams.map((x) => x.add.player.id)).toEqual([7]);
  });
});
