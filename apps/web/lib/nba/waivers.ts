// Waivers & streaming: which free agent to add, and whom to drop, to win this week without
// giving away the season. Pure: the page passes in league data; tests run without network.
//
// For every candidate add c and every player d who could be dropped, re-run the week projection
// (the daily lineup optimizer for each remaining day) with c in place of d. The gain in
// projected points becomes a gain in win probability against this week's opponent.
//
// Season value works the same way over the rest of the season (teamValue): the change in
// starting-lineup points, so positions, the schedule, injuries and IL returns all count. A sixth
// center is worth only the starts he'd actually get; a guard who fills open days is worth more.

import type { FreeAgent, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { irEligible } from "@fantasy-copilot/fantasy-core";
import { etDate, matchupPeriodOf, scoringPeriodForDate } from "./calendar";
import { perGameProjection } from "./projection";
import { teamValue, weighted, type ValueContext } from "./trade";
import { projectTeamWeek, winProbability, type WeekInputs } from "./week";

export interface WaiverInputs {
  /** The roster from tomorrow on (ESPN's, including moves made after today's lock). */
  roster: RosterPlayer[];
  /** Players dropped after today's lock: they still score today. */
  leaving?: RosterPlayer[];
  freeAgents: FreeAgent[];
  week: WeekInputs;
  myBanked: number;
  oppBanked: number;
  /** This week's projected remaining for both sides (week page numbers); null on a bye. */
  myRemaining: number;
  oppRemaining: number | null;
  /** My players whose game today has started (can't be dropped now). */
  lockedToday: Set<number>;
  /** Pro teams whose game today has started (an add can't play in it). */
  startedToday: Set<number>;
  /** Roster spots excluding IR (starters + bench). */
  rosterLimit: number;
  /** IR slots in this league. */
  irSlots?: number;
  /**
   * Today's roster has locked (a game has tipped): an add or drop made now takes effect
   * tomorrow, so the add can't play today and the dropped player still can.
   */
  rosterLocked?: boolean;
  /** Last day of the league season (rest-of-season horizon). */
  lastDay: number;
  /**
   * Rest-of-season valuation (lib/nba/trade.ts valueContext, with injuries). Without it the
   * season value falls back to raw points (fppg x games), which ignores lineup fit.
   */
  season?: ValueContext;
}

export interface WaiverCandidate {
  player: RosterPlayer;
  status: FreeAgent["status"];
  waiverUntil: number | null;
  fppg: number;
  /** Games left this week that he can actually play (after a claim processes, if waivers). */
  weekGames: number;
  /** Rest-of-season value: fppg x expected games after this week. */
  ros: number;
}

export interface StreamOption {
  add: WaiverCandidate;
  drop: RosterPlayer | null;
  /** Instead of a drop: move this ruled-out player to the IR slot to open a spot. */
  il: RosterPlayer | null;
  dropRos: number;
  /** Projected points gained this week. */
  deltaPts: number;
  /** Extra lineup starts this week. */
  deltaStarts: number;
  /** Change in P(win this week), or null on a bye week. */
  deltaWin: number | null;
  /**
   * Rest-of-season lineup points gained (negative = a stream that costs later value). With a
   * season context it counts only the starts each player would get on this roster.
   */
  rosDelta: number;
  /** Ranking value: rosDelta with playoff-week points counted double. */
  seasonScore: number;
  /** Rest of season for the add on this roster: games he's available for and how many he'd start. */
  addUsage: { games: number; starts: number } | null;
  /** Starts the dropped player would have made for the rest of the season. */
  dropStarts: number | null;
  /**
   * The move's whole value in expected wins: this week's change in win chance plus the rest
   * of the season's lineup points converted to wins (see `pointsToWins`).
   */
  netWins: number;
  /** The rest-of-season part of netWins (after this week). */
  laterWins: number;
}

const MAX_CANDIDATES = 45;
/** Long-term candidates evaluated by lineup fit (best raw rest-of-season values first). */
const MAX_LONG_TERM = 25;
const MIN_SEASON_GAIN = 50;

const availability = (p: RosterPlayer) => {
  const proj = p.projection;
  const gp = proj?.avg && proj.total ? proj.total / proj.avg : 70;
  return Math.min(1, gp / 82);
};

export function waiverAnalysis(a: WaiverInputs): {
  baseWin: number | null;
  candidates: WaiverCandidate[];
  /**
   * Best moves overall, by expected wins this week and after (each add with the drop that
   * maximizes it). Positive only.
   */
  best: StreamOption[];
  /** Wins per weighted season point (for explaining the conversion). */
  winsPerPoint: number;
  /** Moves that raise this week's projection, best first (with the drop that helps most now). */
  thisWeek: StreamOption[];
  /** Moves that add rest-of-season value, best first (with the drop that keeps the most value). */
  longTerm: StreamOption[];
} {
  const { week } = a;
  const lastWeekDay = Math.max(...week.periods);
  const gamesBetween = (pro: number, from: number, to: number) =>
    countGames(week.games, pro, from, to);
  const ros = (p: RosterPlayer) =>
    perGameProjection(p).fppg *
    availability(p) *
    gamesBetween(p.proTeamId, lastWeekDay + 1, a.lastDay);

  // When each free agent can first play: after his claim processes, and not in a game already
  // under way (or not today at all once the roster has locked). Starts from the week's own
  // windows (players added after today's lock).
  const availableFrom = new Map(week.availableFrom ?? []);
  const candidates: WaiverCandidate[] = a.freeAgents
    .map((f) => {
      let from = week.fromPeriod;
      if (f.status === "WAIVERS" && f.waiverUntil) {
        from = Math.max(from, scoringPeriodForDate(etDate(new Date(f.waiverUntil))));
      }
      if (from === week.fromPeriod && (a.rosterLocked || a.startedToday.has(f.player.proTeamId))) {
        from += 1;
      }
      availableFrom.set(f.player.id, from);
      return {
        player: f.player,
        status: f.status,
        waiverUntil: f.waiverUntil,
        fppg: perGameProjection(f.player).fppg,
        weekGames: gamesBetween(f.player.proTeamId, from, lastWeekDay),
        ros: ros(f.player),
      };
    })
    .filter((c) => c.fppg > 0)
    .sort((x, y) => y.fppg - x.fppg);

  const current = [...a.roster, ...(a.leaving ?? [])];
  const baseline = projectTeamWeek(current, week);
  const baseStarts = [...baseline.startsByDay.values()].reduce((s, d) => s + d.size, 0);
  const baseWin =
    a.oppRemaining == null
      ? null
      : winProbability(a.myBanked, a.myRemaining, a.oppBanked, a.oppRemaining);

  // Drop candidates: everyone who can be dropped now (after the roster lock, anyone: the drop
  // takes effect tomorrow). Lineup fit decides, not raw points.
  const droppable = a.roster
    .filter((p) => (a.rosterLocked || !a.lockedToday.has(p.id)) && p.slot !== "IR")
    .map((p) => ({ p, ros: ros(p), il: null }));
  const active = a.roster.filter((p) => p.slot !== "IR" && !p.pendingIR);
  const openSpot = active.length < a.rosterLimit;
  // No open spot, but a ruled-out player could move to a free IR slot instead of a drop.
  const irFree = a.roster.filter((p) => p.slot === "IR" || p.pendingIR).length < (a.irSlots ?? 0);
  const toIL =
    !openSpot && irFree
      ? (active.filter((p) => irEligible(p.injuryStatus)).sort((x, y) => ros(x) - ros(y))[0] ??
        null)
      : null;
  const drops: { p: RosterPlayer | null; ros: number; il: RosterPlayer | null }[] = [
    ...(openSpot ? [{ p: null, ros: 0, il: null }] : []),
    ...(toIL ? [{ p: null, ros: 0, il: toIL }] : []),
    ...droppable,
  ];

  // Evaluate the free agents most likely to matter this week, plus the best long-term adds.
  const shortlist = new Map<number, WaiverCandidate>();
  for (const c of [...candidates]
    .sort((x, y) => y.fppg * y.weekGames - x.fppg * x.weekGames)
    .slice(0, MAX_CANDIDATES))
    shortlist.set(c.player.id, c);
  for (const c of [...candidates].sort((x, y) => y.ros - x.ros).slice(0, MAX_LONG_TERM))
    shortlist.set(c.player.id, c);

  // Rest of season with each move, by lineup fit (positions, schedule, injuries, IL returns).
  const baseSeason = a.season ? teamValue(a.roster, a.season) : null;
  // Points to wins: a weekly matchup's win chance moves by about this much per point of
  // margin (the slope of the week's win probability at an even matchup and a typical week).
  const typicalWeek = baseSeason
    ? (7 * baseSeason.regular) / Math.max(1, regularDaysLeft(a.season!))
    : a.myRemaining;
  const winsPerPoint = pointsToWins(Math.max(typicalWeek, 1));
  const seasonOf = (
    c: WaiverCandidate,
    d: { p: RosterPlayer | null; ros: number; il: RosterPlayer | null },
  ) => {
    if (!a.season || !baseSeason) {
      const delta = c.ros - d.ros;
      return { rosDelta: delta, seasonScore: delta, addUsage: null, dropStarts: null };
    }
    // A waiver claim plays only once it clears.
    const from = availableFrom.get(c.player.id) ?? a.season.fromDay;
    const ctx =
      from > a.season.fromDay
        ? {
            ...a.season,
            outUntil: new Map(a.season.outUntil).set(
              c.player.id,
              Math.max(from, a.season.outUntil.get(c.player.id) ?? 0),
            ),
          }
        : a.season;
    const roster = [
      ...a.roster
        .filter((p) => p !== d.p)
        .map((p) => (d.il && p.id === d.il.id ? { ...p, slot: "IR" } : p)),
      { ...c.player, slot: "BE" },
    ];
    const v = teamValue(roster, ctx);
    return {
      rosDelta: v.regular + v.playoffs - (baseSeason.regular + baseSeason.playoffs),
      seasonScore: weighted(v) - weighted(baseSeason),
      addUsage: v.usage.get(c.player.id) ?? null,
      dropStarts: d.p ? (baseSeason.usage.get(d.p.id)?.starts ?? 0) : null,
    };
  };

  const best: StreamOption[] = [];
  const thisWeek: StreamOption[] = [];
  const longTerm: StreamOption[] = [];
  for (const c of shortlist.values()) {
    const options: StreamOption[] = [];
    for (const d of drops) {
      // A drop made after the lock still plays today; otherwise he's gone now.
      const keepToday = a.rosterLocked && d.p;
      const roster = [
        ...current.filter((p) => keepToday || p !== d.p),
        { ...c.player, slot: "BE" },
      ];
      const availableUntil = new Map(week.availableUntil ?? []);
      if (keepToday) availableUntil.set(d.p!.id, week.fromPeriod);
      const tw = projectTeamWeek(roster, { ...week, availableFrom, availableUntil });
      const deltaPts = tw.remaining - baseline.remaining;
      const starts = [...tw.startsByDay.values()].reduce((s, x) => s + x.size, 0);
      options.push({
        add: c,
        drop: d.p,
        il: d.il,
        dropRos: d.ros,
        deltaPts,
        deltaStarts: starts - baseStarts,
        deltaWin:
          a.oppRemaining == null || baseWin == null
            ? null
            : winProbability(a.myBanked, a.myRemaining + deltaPts, a.oppBanked, a.oppRemaining) -
              baseWin,
        ...seasonOf(c, d),
        netWins: 0,
        laterWins: 0,
      });
      const o = options.at(-1)!;
      // Season points include this week's; count those once, through the win chance.
      o.laterWins = winsPerPoint * (o.seasonScore - o.deltaPts);
      o.netWins = (o.deltaWin ?? 0) + o.laterWins;
    }
    // Ties (bench players who'd start nothing either way): keep the better depth piece.
    const top = [...options].sort((x, y) => y.netWins - x.netWins || x.dropRos - y.dropRos)[0];
    if (top && top.netWins > 0.01) best.push(top);
    const bestWeek = bestForWeek(options);
    if (bestWeek && bestWeek.deltaPts > 0.5) thisWeek.push(bestWeek);
    // Long-term adds must be worth it: at least ~2 games of a good player over the season.
    const bestSeason = bestForSeason(options);
    if (bestSeason && bestSeason.rosDelta > MIN_SEASON_GAIN) longTerm.push(bestSeason);
  }
  thisWeek.sort(
    (x, y) =>
      (y.deltaWin ?? 0) - (x.deltaWin ?? 0) ||
      y.deltaPts - x.deltaPts ||
      y.seasonScore - x.seasonScore,
  );
  longTerm.sort((x, y) => y.seasonScore - x.seasonScore || y.deltaPts - x.deltaPts);
  best.sort((x, y) => y.netWins - x.netWins);
  return { baseWin, candidates, best, winsPerPoint, thisWeek, longTerm };
}

/**
 * This week's best drop for an add: the most points this week, but among drops that get
 * close to it (within 2 points or 10%), the one that keeps the most season value. Streaming
 * shouldn't cost a useful player when a bench piece does the same job.
 */
function bestForWeek(options: StreamOption[]): StreamOption | null {
  if (!options.length) return null;
  const top = Math.max(...options.map((o) => o.deltaPts));
  const near = options.filter((o) => o.deltaPts >= top - Math.max(2, 0.1 * Math.abs(top)));
  return near.sort((x, y) => y.seasonScore - x.seasonScore || y.deltaPts - x.deltaPts)[0]!;
}

/** Long term: the most season value; among drops within 10 points of it, the best this week. */
function bestForSeason(options: StreamOption[]): StreamOption | null {
  if (!options.length) return null;
  const top = Math.max(...options.map((o) => o.seasonScore));
  return options
    .filter((o) => o.seasonScore >= top - 10)
    .sort((x, y) => y.deltaPts - x.deltaPts || y.seasonScore - x.seasonScore)[0]!;
}

function countGames(games: ProGame[], pro: number, from: number, to: number) {
  let n = 0;
  for (const g of games) {
    if (g.scoringPeriodId < from || g.scoringPeriodId > to) continue;
    if (g.homeProTeamId === pro || g.awayProTeamId === pro) n++;
  }
  return n;
}

/** Regular-season days left in a value context (its horizon minus the playoffs). */
function regularDaysLeft(ctx: ValueContext): number {
  let n = 0;
  for (let d = ctx.fromDay; d <= ctx.lastDay; d++) if (matchupPeriodOf(d) <= ctx.regularWeeks) n++;
  return n;
}

/**
 * Expected wins per point of weekly margin: the slope of the week's win probability at an
 * even matchup where both teams project `week` points.
 */
export function pointsToWins(week: number): number {
  return (
    (winProbability(0, week + 0.5, 0, week - 0.5) - winProbability(0, week - 0.5, 0, week + 0.5)) /
    2
  );
}
