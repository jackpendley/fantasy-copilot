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
import {
  expandSlots,
  irEligible,
  isStartingSlot,
  slotAccepts,
  type Position,
} from "@fantasy-copilot/fantasy-core";
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
  /** Players Jack never drops (lib/nba/prefs.ts): no move suggests dropping them. */
  noDrop?: Set<number>;
  /** Jack's ESPN watch list: these free agents are always evaluated (the Interested list). */
  watch?: Set<number>;
  /** Roster spots excluding IR (starters + bench). */
  rosterLimit: number;
  /** IR slots in this league. */
  irSlots?: number;
  /**
   * Today's roster has locked (a game has tipped): an add or drop made now takes effect
   * tomorrow, so the add can't play today and the dropped player still can.
   */
  rosterLocked?: boolean;
  /**
   * Today's first tip (ms), while the roster hasn't locked yet: a move can wait for it, so the
   * dropped player keeps today's game and the add counts from tomorrow.
   */
  firstTip?: number | null;
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
  /** He's the one the IR-return plan cuts anyway: who comes back for him. */
  dropCutFor: string | null;
  /** With this move, who comes back from IR and whom the roster cuts for him (teamValue). */
  ilCuts: { back: string; drop: string }[];
  /**
   * The move's whole value in expected wins: this week's change in win chance plus the rest
   * of the season's lineup points converted to wins (see `pointsToWins`).
   */
  netWins: number;
  /** The rest-of-season part of netWins (after this week). */
  laterWins: number;
  /** The lineup points behind laterWins: after this week, playoff days counted double. */
  laterPts: number;
  /**
   * Worth more made just after today's first tip than now: the dropped player keeps today's
   * game and the add counts from tomorrow (often an extra start).
   */
  timing?: "afterTip";
}

const MAX_CANDIDATES = 45;
/** Long-term candidates evaluated by lineup fit (best raw rest-of-season values first). */
const MAX_LONG_TERM = 25;
const MIN_SEASON_GAIN = 50;
/** Adds evaluated for the starts they'd add to this week's lineups (open slots first). */
const MAX_FILLS = 25;

const availability = (p: RosterPlayer) => {
  const proj = p.projection;
  const gp = proj?.avg && proj.total ? proj.total / proj.avg : 70;
  return Math.min(1, gp / 82);
};

/**
 * The free-agent pool with what the table shows: projection, games he can still play this
 * week (after a claim clears, and not in a game already under way) and rest-of-season points.
 * Cheap; the Free agents view uses it without the add-and-drop loop.
 */
export function waiverCandidates(
  a: Pick<WaiverInputs, "freeAgents" | "week" | "rosterLocked" | "startedToday" | "lastDay">,
): { candidates: WaiverCandidate[]; availableFrom: Map<number, number> } {
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
  return { candidates, availableFrom };
}

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
  /** Watched free agents, each with his best drop (even when no drop helps). */
  watched: StreamOption[];
  /** Every way to make room for each evaluated add (by player id), best expected wins first. */
  dropOptions: Map<number, StreamOption[]>;
} {
  const { week } = a;
  const lastWeekDay = Math.max(...week.periods);
  const gamesBetween = (pro: number, from: number, to: number) =>
    countGames(week.games, pro, from, to);
  const ros = (p: RosterPlayer) =>
    perGameProjection(p).fppg *
    availability(p) *
    gamesBetween(p.proTeamId, lastWeekDay + 1, a.lastDay);

  const { candidates, availableFrom } = waiverCandidates(a);

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
    .filter(
      (p) =>
        (a.rosterLocked || !a.lockedToday.has(p.id)) && p.slot !== "IR" && !a.noDrop?.has(p.id),
    )
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
  // Volume misses a cheap player who'd fill open lineup slots: also the adds worth the most
  // starts against this week's lineups as they stand (an open slot he fits counts his whole
  // projection; otherwise what he'd add over the weakest starter he could replace).
  const starting = expandSlots(week.slotCounts).filter(isStartingSlot);
  const teamsOn = new Map(
    week.periods.map((sp) => [
      sp,
      new Set(
        week.games
          .filter((g) => g.scoringPeriodId === sp)
          .flatMap((g) => [g.homeProTeamId, g.awayProTeamId]),
      ),
    ]),
  );
  const asOf = week.asOf ?? week.fromPeriod;
  const valueOf = new Map(current.map((p) => [p.id, perGameProjection(p, asOf).fppg]));
  const fills = (c: WaiverCandidate) => {
    const pos = c.player.positions as Position[];
    const from = availableFrom.get(c.player.id) ?? week.fromPeriod;
    let gain = 0;
    for (const sp of week.periods) {
      if (sp < from || !teamsOn.get(sp)?.has(c.player.proTeamId)) continue;
      const used = [...(baseline.slotsByDay.get(sp) ?? new Map<number, string>())];
      const open = [...starting];
      for (const [, slot] of used) {
        const k = open.indexOf(slot);
        if (k >= 0) open.splice(k, 1);
      }
      if (open.some((slot) => slotAccepts(slot, pos))) {
        gain += c.fppg;
        continue;
      }
      const weakest = Math.min(
        ...used.filter(([, slot]) => slotAccepts(slot, pos)).map(([id]) => valueOf.get(id) ?? 0),
      );
      if (Number.isFinite(weakest)) gain += Math.max(0, c.fppg - weakest);
    }
    return gain;
  };
  for (const { c } of candidates
    .map((c) => ({ c, gain: fills(c) }))
    .filter((x) => x.gain > 0)
    .sort((x, y) => y.gain - x.gain)
    .slice(0, MAX_FILLS))
    shortlist.set(c.player.id, c);
  for (const c of candidates) if (a.watch?.has(c.player.id)) shortlist.set(c.player.id, c);

  // Rest of season with each move, by lineup fit (positions, schedule, injuries, IL returns).
  const baseSeason = a.season ? teamValue(a.roster, a.season) : null;
  // A move that takes effect on a later day (a claim, or any move after the lock) leaves the
  // days before it as they are: both rosters are compared from that day on.
  const baseFrom = new Map<number, ReturnType<typeof teamValue>>();
  const seasonFrom = (day: number) => {
    if (day <= a.season!.fromDay) return { ctx: a.season!, base: baseSeason! };
    const ctx = { ...a.season!, fromDay: day };
    if (!baseFrom.has(day)) baseFrom.set(day, teamValue(a.roster, ctx));
    return { ctx, base: baseFrom.get(day)! };
  };
  /** The first day a move with this add counts (a claim processes, or tomorrow after the lock). */
  const moveDay = (c: WaiverCandidate) => availableFrom.get(c.player.id) ?? week.fromPeriod;
  /** The move waits for that day: a waiver claim, or any move once today's roster has locked. */
  const delayed = (c: WaiverCandidate) =>
    moveDay(c) > week.fromPeriod && (Boolean(a.rosterLocked) || c.status === "WAIVERS");
  // Points to wins: a weekly matchup's win chance moves by about this much per point of
  // margin (the slope of the week's win probability at an even matchup and a typical week).
  const typicalWeek = baseSeason
    ? (7 * baseSeason.regular) / Math.max(1, regularDaysLeft(a.season!))
    : a.myRemaining;
  const winsPerPoint = pointsToWins(Math.max(typicalWeek, 1));
  const seasonOf = (
    c: WaiverCandidate,
    d: { p: RosterPlayer | null; ros: number; il: RosterPlayer | null },
    /** The add's first day, and whether the whole move waits for it. */
    first = availableFrom.get(c.player.id),
    waits = delayed(c),
  ) => {
    if (!a.season || !baseSeason) {
      const delta = c.ros - d.ros;
      return {
        rosDelta: delta,
        seasonScore: delta,
        addUsage: null,
        dropStarts: null,
        dropCutFor: null,
        ilCuts: [],
      };
    }
    // A delayed move counts from its day; otherwise the add plays once he can (a game of his
    // already under way today).
    const from = first ?? a.season.fromDay;
    const at = seasonFrom(waits ? from : a.season.fromDay);
    const ctx =
      from > at.ctx.fromDay
        ? {
            ...at.ctx,
            outUntil: new Map(at.ctx.outUntil).set(
              c.player.id,
              Math.max(from, at.ctx.outUntil.get(c.player.id) ?? 0),
            ),
          }
        : at.ctx;
    const roster = [
      ...a.roster
        .filter((p) => p !== d.p)
        .map((p) => (d.il && p.id === d.il.id ? { ...p, slot: "IR" } : p)),
      { ...c.player, slot: "BE" },
    ];
    const v = teamValue(roster, ctx);
    const b = at.base;
    return {
      rosDelta: v.regular + v.playoffs - (b.regular + b.playoffs),
      seasonScore: weighted(v) - weighted(b),
      addUsage: v.usage.get(c.player.id) ?? null,
      dropStarts: d.p ? (b.usage.get(d.p.id)?.starts ?? 0) : null,
      dropCutFor: d.p
        ? (b.activations.find((x) => x.drop?.id === d.p!.id)?.player.name ?? null)
        : null,
      ilCuts: v.activations.flatMap((x) =>
        x.drop ? [{ back: x.player.name, drop: x.drop.name }] : [],
      ),
    };
  };

  // Before today's first tip, a move can also wait for it (this league locks rosters at the
  // day's first tip): the dropped player keeps today's game and the add counts from tomorrow.
  // For a drop who plays today that's often worth an extra start, so both timings are valued.
  const playsToday = teamsOn.get(week.fromPeriod) ?? new Set<number>();
  const canWait = (c: WaiverCandidate, d: { p: RosterPlayer | null }) =>
    a.firstTip != null &&
    !a.rosterLocked &&
    d.p != null &&
    playsToday.has(d.p.proTeamId) &&
    moveDay(c) === week.fromPeriod;

  const evaluate = (
    c: WaiverCandidate,
    d: { p: RosterPlayer | null; ros: number; il: RosterPlayer | null },
    wait: boolean,
  ): StreamOption => {
    const first = wait ? week.fromPeriod + 1 : moveDay(c);
    // The dropped player plays until the move takes effect (a claim processes, or tomorrow
    // after the lock or the tip it waits for); a free-agent move before the lock is immediate.
    const waits = wait || delayed(c);
    const keep = waits && d.p;
    const roster = [...current.filter((p) => keep || p !== d.p), { ...c.player, slot: "BE" }];
    const availableUntil = new Map(week.availableUntil ?? []);
    if (keep) availableUntil.set(d.p!.id, first - 1);
    const from = wait ? new Map(availableFrom).set(c.player.id, first) : availableFrom;
    const tw = projectTeamWeek(roster, { ...week, availableFrom: from, availableUntil });
    const deltaPts = tw.remaining - baseline.remaining;
    const starts = [...tw.startsByDay.values()].reduce((s, x) => s + x.size, 0);
    const o: StreamOption = {
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
      ...seasonOf(c, d, first, waits),
      netWins: 0,
      laterWins: 0,
      laterPts: 0,
      ...(wait && { timing: "afterTip" as const }),
    };
    // Season points include this week's; count those once, through the win chance.
    o.laterPts = o.seasonScore - o.deltaPts;
    o.laterWins = winsPerPoint * o.laterPts;
    o.netWins = (o.deltaWin ?? 0) + o.laterWins;
    return o;
  };

  const best: StreamOption[] = [];
  const dropOptions = new Map<number, StreamOption[]>();
  const thisWeek: StreamOption[] = [];
  const longTerm: StreamOption[] = [];
  for (const c of shortlist.values()) {
    const options: StreamOption[] = [];
    for (const d of drops) {
      const now = evaluate(c, d, false);
      const afterTip = canWait(c, d) ? evaluate(c, d, true) : null;
      options.push(afterTip && afterTip.netWins > now.netWins ? afterTip : now);
    }
    // Ties (bench players who'd start nothing either way): keep the better depth piece.
    const ranked = [...options].sort((x, y) => y.netWins - x.netWins || x.dropRos - y.dropRos);
    dropOptions.set(c.player.id, ranked);
    const top = ranked[0];
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
  const watched = [...dropOptions]
    .filter(([id]) => a.watch?.has(id))
    .flatMap(([, options]) => options.slice(0, 1))
    .sort((x, y) => y.netWins - x.netWins);
  return { baseWin, candidates, best, winsPerPoint, thisWeek, longTerm, watched, dropOptions };
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

/** The adds the Moves page shows: the 8 best moves, then up to 5 this-week-only streams. */
export function shownMoves(a: Pick<ReturnType<typeof waiverAnalysis>, "best" | "thisWeek">): {
  best: StreamOption[];
  streams: StreamOption[];
} {
  const best = a.best.slice(0, 8);
  const shown = new Set(best.map((o) => o.add.player.id));
  const streams = a.thisWeek
    .filter((o) => !shown.has(o.add.player.id) && (o.deltaWin ?? 0) > 0.005)
    .slice(0, 5);
  return { best, streams };
}
