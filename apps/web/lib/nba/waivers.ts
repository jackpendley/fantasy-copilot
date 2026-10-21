// Waivers & streaming: which free agent to add, and whom to drop, to win this week without
// giving away the season. Pure: the page passes in league data; tests run without network.
//
// For every candidate add c and each sensible drop d, re-run the week projection (the daily
// lineup optimizer for each remaining day) with c in place of d. The gain in projected points
// becomes a gain in win probability against this week's opponent. Rest-of-season value
// (fppg x expected games after this week) flags streams that cost long-term value.

import type { FreeAgent, ProGame, RosterPlayer } from "@fantasy-copilot/espn";
import { irEligible } from "@fantasy-copilot/fantasy-core";
import { etDate, scoringPeriodForDate } from "./calendar";
import { perGameProjection } from "./projection";
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
  /** Rest-of-season value gained (negative = a pure stream that costs later value). */
  rosDelta: number;
}

const MAX_DROPS = 5;
const MAX_CANDIDATES = 45;
const MIN_SEASON_GAIN = 50;

const availability = (p: RosterPlayer) => {
  const proj = p.projection;
  const gp = proj?.avg && proj.total ? proj.total / proj.avg : 70;
  return Math.min(1, gp / 82);
};

export function waiverAnalysis(a: WaiverInputs): {
  baseWin: number | null;
  candidates: WaiverCandidate[];
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

  // Drop candidates: the lowest rest-of-season values among players who can be dropped now
  // (after the roster lock any player can be: the drop takes effect tomorrow).
  const droppable = a.roster
    .filter((p) => (a.rosterLocked || !a.lockedToday.has(p.id)) && p.slot !== "IR")
    .map((p) => ({ p, ros: ros(p), il: null }))
    .sort((x, y) => x.ros - y.ros)
    .slice(0, MAX_DROPS);
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
  for (const c of [...candidates].sort((x, y) => y.ros - x.ros).slice(0, 10))
    shortlist.set(c.player.id, c);

  const thisWeek: StreamOption[] = [];
  const longTerm: StreamOption[] = [];
  for (const c of shortlist.values()) {
    let bestWeek: StreamOption | null = null;
    let bestSeason: StreamOption | null = null;
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
      const option: StreamOption = {
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
        rosDelta: c.ros - d.ros,
      };
      if (!bestWeek || betterNow(option, bestWeek)) bestWeek = option;
      if (!bestSeason || betterLater(option, bestSeason)) bestSeason = option;
    }
    if (bestWeek && bestWeek.deltaPts > 0.5) thisWeek.push(bestWeek);
    // Long-term adds must be worth it: at least ~2 games of a good player over the season.
    if (bestSeason && bestSeason.rosDelta > MIN_SEASON_GAIN) longTerm.push(bestSeason);
  }
  thisWeek.sort(
    (x, y) =>
      (y.deltaWin ?? 0) - (x.deltaWin ?? 0) || y.deltaPts - x.deltaPts || y.rosDelta - x.rosDelta,
  );
  longTerm.sort((x, y) => y.rosDelta - x.rosDelta || y.deltaPts - x.deltaPts);
  return { baseWin, candidates, thisWeek, longTerm };
}

/** This week: more points; among near-ties, keep more rest-of-season value. */
function betterNow(x: StreamOption, y: StreamOption) {
  if (Math.abs(x.deltaPts - y.deltaPts) > 1) return x.deltaPts > y.deltaPts;
  return x.rosDelta > y.rosDelta;
}

/** Long term: more rest-of-season value; among near-ties, hurt this week less. */
function betterLater(x: StreamOption, y: StreamOption) {
  if (Math.abs(x.rosDelta - y.rosDelta) > 10) return x.rosDelta > y.rosDelta;
  return x.deltaPts > y.deltaPts;
}

function countGames(games: ProGame[], pro: number, from: number, to: number) {
  let n = 0;
  for (const g of games) {
    if (g.scoringPeriodId < from || g.scoringPeriodId > to) continue;
    if (g.homeProTeamId === pro || g.awayProTeamId === pro) n++;
  }
  return n;
}
