// Season Monte Carlo for an H2H points league with daily lineups (ported from the v3 sim in
// apps/draft-nba/scripts/postdraft/league-sim.mjs, calibrated on 2025-26: weekly CV ~0.13 for
// active managers, add counts within one of each manager's actual).
//
// Per simulated season, day by day from `fromDay`:
//  - each player's availability follows a streaky injury chain (short 2-game and long 15-game
//    spells, extra rest on the 2nd night of back-to-backs for load-managed players);
//  - each manager sets the best lineup on a day with probability `act`, otherwise a standing
//    lineup plays; streaming adds/IR use the manager's weekly add rate within the add cap;
//  - points per game = fppg x season multiplier (projection error) x weekly form x game noise.
// Completed weeks keep their actual results; the current week starts from banked points.

import { isStartingSlot, expandSlots, slotAccepts, type Position } from "./slots";

export interface SimPlayer {
  id: number;
  eligible: readonly Position[];
  proTeamId: number;
  /** Expected fantasy points per game played. */
  fppg: number;
  /** Projected games played per 82 (sets the injury miss rate). */
  gp: number;
  /** Projection error sd as a share of fppg (season-level). */
  sd: number;
  /**
   * A known injury: the first day he can play again (ESPN's estimated return). Until then he
   * sits out; after it, the usual random injury chain applies.
   */
  outUntil?: number;
  /** He's in the IR slot now: activating him later costs the roster its weakest player. */
  reserve?: boolean;
  /**
   * His expected points per game change from `day` on: a fill-in once the regular he replaced
   * returns (MODEL_CARD, teammate returns test 4).
   */
  change?: { day: number; fppg: number };
}

export interface SimTeam {
  id: number;
  roster: SimPlayer[];
  /** Share of days the manager sets an optimal lineup (1 = daily). */
  act: number;
  /** Average waiver adds per week. */
  addsPerWeek: number;
  /**
   * Who goes when the IR-slot player comes back to a full roster (a player id): the one who'd
   * add the fewest lineup points from his return on, decided by the caller (the Waivers rule).
   * Without it, or once that player is gone, the lowest-fppg player goes.
   */
  irCut?: number;
  /**
   * A roster change on a later day (a waiver claim that clears then). Until `day` the roster
   * plays as it is; on `day`, before anyone's moves, `drop` leaves for the free-agent pool (the
   * roster's weakest player if he's already gone) and `add` takes his place, and `irCut`, when
   * given, becomes whom an IR return cuts. `add` is the team's from the start: no one else picks
   * him up, and his injuries run their course meanwhile.
   */
  next?: { day: number; drop?: number; add: SimPlayer; irCut?: number };
}

export interface SimMatchup {
  period: number;
  home: number;
  away: number;
  /** "HOME" | "AWAY" | "TIE" once final; null while undecided. */
  winner: "HOME" | "AWAY" | "TIE" | null;
}

export interface SimInput {
  teams: SimTeam[];
  freeAgents: SimPlayer[];
  slotCounts: Record<string, number>;
  /** proTeamId -> days (scoring periods) with a game. */
  gameDays: Map<number, Set<number>>;
  periodOf: (day: number) => number;
  /** First day still to be played, and the season's last day. */
  fromDay: number;
  lastDay: number;
  /** Regular-season H2H schedule (byes omitted). */
  matchups: SimMatchup[];
  regularWeeks: number;
  /** Points already scored in a period, by team (completed weeks and the current one). */
  banked: Map<number, Map<number, number>>;
  /** The three playoff weeks: quarterfinal (seeds 3-6), semifinal, final. Top 2 seeds get byes. */
  playoffWeeks: [number, number, number];
  addCapPerWeek: number;
  seasons: number;
  seed?: number;
  /** Called after each simulated season with how it ended (for diagnostics and paired errors). */
  inspect?: (season: number, outcome: SeasonOutcome) => void;
  /** Per-game noise and weekly form sd (calibrated defaults). */
  noise?: number;
  form?: number;
  /**
   * Play each season's playoffs this many times from where its regular season ended (default
   * 1). Title and final odds then count each replay as a share, which removes most of the
   * playoff luck from the estimate at a fraction of the cost of more seasons. The first replay
   * is the season's own playoffs, so 1 is exactly the plain simulation.
   */
  playoffReplays?: number;
  /**
   * Position-aware streaming (MODEL_CARD pre-registrations 2026-11-16): streams and IR pickups
   * value players by the lineup points they add this week (positions, schedule, who's out) and
   * the share of games they'd start, not by raw points. Off: the calibrated raw-value rule.
   */
  fitStreams?: boolean;
}

/** One simulated season's ending, teams in input order. */
export interface SeasonOutcome {
  /** Final rosters (player ids, IR included). */
  rosters: number[][];
  wins: number[];
  /** Team ids: the champion, the #1 seed and the six playoff teams. */
  champion: number;
  seed1: number;
  playoffs: number[];
  /** Each team's share of the playoff replays it won (input order); 1 for the champion without replays. */
  titleShares: number[];
  /** Each team's points by period (input order; index = period), banked points included. */
  points: number[][];
  /** Each team's streams and IR pickups in the rest of the regular season (input order). */
  adds: number[];
  /** Who they were (player ids, in the order added; input order of teams). */
  pickups: number[][];
}

export interface SimTeamResult {
  teamId: number;
  expWins: number;
  expPointsFor: number;
  playoffs: number;
  seed1: number;
  /** A first-round bye: a top-2 seed. */
  bye: number;
  final: number;
  champ: number;
  /** Title and a bye together (champ - champBye is titles won from seeds 3-6). */
  champBye: number;
}

/** What a random draw is for: part of its key. */
const DRAW = {
  mult: 1,
  miss: 2,
  spellKind: 3,
  spellLen: 4,
  injury: 5,
  adds: 6,
  form: 7,
  order: 8,
  active: 9,
  game: 10,
} as const;

/** One murmur3-style mixing step: the hash of `key` after `h`. */
function mix(h: number, k: number): number {
  h = Math.imul(h ^ (k >>> 0), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

const unit = (h: number) => ((h >>> 0) + 0.5) / 2 ** 32;

/** A uniform number in [0, 1) determined only by `seed` and `key` (murmur3-style mixing). */
export function keyedUniform(seed: number, key: readonly number[]): number {
  let h = seed >>> 0;
  for (const k of key) h = mix(h, k);
  return unit(h);
}

export function simulateSeason(input: SimInput): SimTeamResult[] {
  const run = simulation(input);
  for (;;) {
    const step = run.next();
    if (step.done) return step.value;
  }
}

export interface SimProgress {
  /** Report every this many seasons. */
  every: number;
  /**
   * The odds so far. With common random numbers the first k seasons are exactly a k-season
   * run, so these are a fair (just noisier) preview of the final numbers.
   */
  report: (partial: SimTeamResult[], seasonsDone: number) => void | Promise<void>;
}

/**
 * The same simulation, pausing every ~`sliceMs` so a server keeps answering other requests
 * while it runs, and optionally reporting the odds so far as it goes.
 */
export async function simulateSeasonAsync(
  input: SimInput,
  sliceMs = 25,
  progress?: SimProgress,
): Promise<SimTeamResult[]> {
  const run = simulation(input);
  let sliceStart = Date.now();
  let done = 0;
  for (;;) {
    const step = run.next();
    if (step.done) return step.value;
    done++;
    if (progress && done % progress.every === 0 && done < input.seasons)
      await progress.report(step.value(), done);
    if (Date.now() - sliceStart >= sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }
}

/**
 * A player as the simulation sees him: the input player plus lookups precomputed once per run.
 * Health is tracked per player id (`h`), like the input, so two entries with one id share it.
 */
interface P {
  src: SimPlayer;
  fppg: number;
  /** Index of his id in the per-season health arrays. */
  h: number;
  /** 1 on days his team plays (index = day). */
  days: Uint8Array;
  /** His team's games from each day to the end of that day's week. */
  left: Uint8Array;
  /** Starting slots he can fill, as a bitmask over the open slots. */
  elig: number;
}

/** One season per step, yielding the summary so far (as a function); returns the summary. */
function* simulation(input: SimInput): Generator<() => SimTeamResult[], SimTeamResult[]> {
  const NOISE = input.noise ?? 0.5;
  const FORM = input.form ?? 0.28;
  const OPEN = expandSlots(input.slotCounts).filter(isStartingSlot);
  const { fromDay, lastDay } = input;
  // Common random numbers: every draw is a hash of what it is for (season, player or team, day
  // or week, purpose), not the next number in one stream. A roster change then only changes
  // the draws it touches, so two runs differ because the inputs differ, not by reshuffled luck.
  // Each season hashes (seed, season, player or team) once; a draw then mixes in the rest.
  const seed = (input.seed ?? 20261018) >>> 0;
  const draw = (prefix: number, a: number, b: number) => unit(mix(mix(prefix, a), b));
  const gauss = (prefix: number, a: number, b: number) => {
    const k = mix(mix(prefix, a), b);
    return (
      Math.sqrt(-2 * Math.log(unit(mix(k, 1)) || 1e-9)) * Math.cos(2 * Math.PI * unit(mix(k, 2)))
    );
  };
  const poisson = (lam: number, u: number) => {
    let k = 0;
    let p = Math.exp(-lam);
    let s = p;
    while (u > s && k < 10) {
      k++;
      p *= lam / k;
      s += p;
    }
    return k;
  };
  const geom = (mean: number, u: number) =>
    1 + Math.floor(Math.log(1 - u) / Math.log(1 - 1 / mean));
  const spellLength = (prefix: number, d: number) =>
    draw(prefix, d, DRAW.spellKind) < 0.75
      ? geom(2, draw(prefix, d, DRAW.spellLen))
      : geom(15, draw(prefix, d, DRAW.spellLen));

  // Calendar tables: the week of each day, and per pro team its game days and games left in
  // the week from each day.
  const period = new Int32Array(lastDay + 2);
  for (let d = 0; d <= lastDay; d++) period[d] = input.periodOf(d);
  const proTables = new Map<number, { days: Uint8Array; left: Uint8Array }>();
  const tablesOf = (pro: number) => {
    let t = proTables.get(pro);
    if (!t) {
      const days = new Uint8Array(lastDay + 2);
      for (const d of input.gameDays.get(pro) ?? []) if (d >= 0 && d <= lastDay + 1) days[d] = 1;
      const left = new Uint8Array(lastDay + 2);
      for (let d = lastDay; d >= 0; d--)
        left[d] = days[d]! + (d < lastDay && period[d + 1] === period[d] ? left[d + 1]! : 0);
      t = { days, left };
      proTables.set(pro, t);
    }
    return t;
  };

  const healthIndex = new Map<number, number>();
  const idOf: number[] = [];
  const wrapped = new Map<SimPlayer, P>();
  /** Players whose points per game change on a later day (`SimPlayer.change`). */
  const changing: P[] = [];
  /** Sets their points per game as of day `d`; whether any changed. */
  const pointsAsOf = (d: number) => {
    let changed = false;
    for (const x of changing) {
      const c = x.src.change!;
      const v = d >= c.day ? c.fppg : x.src.fppg;
      if (x.fppg !== v) {
        x.fppg = v;
        changed = true;
      }
    }
    return changed;
  };
  const wrap = (sp: SimPlayer): P => {
    let x = wrapped.get(sp);
    if (!x) {
      let h = healthIndex.get(sp.id);
      if (h == null) {
        h = idOf.length;
        healthIndex.set(sp.id, h);
        idOf.push(sp.id);
      }
      let elig = 0;
      OPEN.forEach((slot, j) => {
        if (slotAccepts(slot, sp.eligible)) elig |= 1 << j;
      });
      x = { src: sp, fppg: sp.fppg, h, ...tablesOf(sp.proTeamId), elig };
      wrapped.set(sp, x);
      if (sp.change) changing.push(x);
    }
    return x;
  };
  const teams = input.teams;
  const n = teams.length;
  const rosters = teams.map((t) => t.roster.map(wrap));
  const inputFAs = input.freeAgents.map(wrap);
  // Roster changes on a later day (SimTeam.next), by team.
  const pending = teams.map((t) =>
    t.next ? { day: Math.max(t.next.day, fromDay), add: wrap(t.next.add) } : null,
  );
  const NH = idOf.length;

  // Greedy by value is optimal on this slot structure (transversal matroid): the same
  // augmenting-path greedy as lineup.ts greedyStarters, on slot bitmasks.
  const owner = new Int32Array(OPEN.length);
  const snap = new Int32Array(OPEN.length);
  let sorted: P[] = [];
  let seen = 0;
  const tryPlace = (pi: number): boolean => {
    const elig = sorted[pi]!.elig;
    for (let j = 0; j < OPEN.length; j++) {
      if ((seen >> j) & 1 || !((elig >> j) & 1)) continue;
      seen |= 1 << j;
      if (owner[j] === -1 || tryPlace(owner[j]!)) {
        owner[j] = pi;
        return true;
      }
    }
    return false;
  };
  const bestLineup = (players: P[]): P[] => {
    sorted = [...players].sort((a, b) => b.fppg - a.fppg);
    owner.fill(-1);
    const seated: P[] = [];
    for (let i = 0; i < sorted.length && seated.length < OPEN.length; i++) {
      snap.set(owner);
      seen = 0;
      if (tryPlace(i)) seated.push(sorted[i]!);
      else owner.set(snap);
    }
    return seated;
  };
  const fitStreams = input.fitStreams ?? false;
  /** Free agents scored by fit at each stream (the best by raw value). */
  const FIT_CANDIDATES = 5;

  const tIndex = new Map(teams.map((t, i) => [t.id, i]));
  const lastPeriod = input.periodOf(lastDay);
  const agg = teams.map(() => ({
    wins: 0,
    pf: 0,
    po: 0,
    seed1: 0,
    bye: 0,
    final: 0,
    champ: 0,
    champBye: 0,
  }));

  // Points already banked, per team per period.
  const banked = teams.map((t) => {
    const arr = new Float64Array(lastPeriod + 1);
    for (const [p, v] of input.banked.get(t.id) ?? []) if (p <= lastPeriod) arr[p] = v;
    return arr;
  });

  // Per-season state, reused across seasons.
  const playerKey = new Int32Array(NH);
  const teamKey = new Int32Array(n);
  const ready = new Uint8Array(NH);
  const readyList = new Int32Array(NH);
  let readyCount = 0;
  const mult = new Float64Array(NH);
  const form = new Float64Array(NH);
  const q = new Float64Array(NH);
  const out = new Int32Array(NH);
  const loadMgd = new Uint8Array(NH);
  const healthyOn = new Int32Array(NH);
  const healthyVal = new Uint8Array(NH);
  const faOwner = new Int32Array(NH);
  /** Each team's streams and IR pickups this season, and who they were. */
  const adds = new Int32Array(n);
  const pickups: number[][] = teams.map(() => []);
  let stamp = 0;
  let day = 0;

  /** His health this season, set up the first time he's looked at. */
  const H = (x: P): number => {
    const h = x.h;
    if (!ready[h]) {
      const p = x.src;
      const miss = Math.min(0.85, Math.max(0.01, 1 - p.gp / 82));
      const spell = 0.75 * 2 + 0.25 * 15;
      mult[h] = Math.max(0.5, 1 + p.sd * gauss(playerKey[h]!, 0, DRAW.mult));
      form[h] = 0;
      q[h] = miss / (spell * (1 - miss));
      out[h] = 0;
      loadMgd[h] = p.gp < 72 ? 1 : 0;
      if (p.outUntil != null && p.outUntil > fromDay) {
        // A known injury: out for his team's games before the estimated return.
        for (let k = fromDay; k < Math.min(p.outUntil, lastDay + 1); k++)
          if (x.days[k]) out[h] = out[h]! + 1;
      } else if (draw(playerKey[h]!, 0, DRAW.miss) < miss) out[h] = spellLength(playerKey[h]!, 0);
      ready[h] = 1;
      readyList[readyCount++] = h;
    }
    return h;
  };
  const outOf = (x: P) => out[H(x)]!;

  /** Healthy for his game today (`day`); decided once per player per day. */
  const isHealthy = (x: P): boolean => {
    if (!x.days[day]) return false;
    const h = x.h;
    if (healthyOn[h] === stamp) return healthyVal[h] === 1;
    H(x);
    let ok = true;
    if (out[h]! > 0) {
      out[h] = out[h]! - 1;
      ok = false;
    } else {
      const bump = loadMgd[h] ? (x.days[day - 1] ? 2 / 1.17 : 1 / 1.17) : 1;
      if (draw(playerKey[h]!, day, DRAW.injury) < q[h]! * bump) {
        out[h] = spellLength(playerKey[h]!, day) - 1;
        ok = false;
      }
    }
    healthyOn[h] = stamp;
    healthyVal[h] = ok ? 1 : 0;
    return ok;
  };

  type TeamState = {
    roster: P[];
    lineups: Map<number, P[]>;
    /**
     * The best lineup from the whole roster, ignoring schedule and health (fitStreams): every
     * player best first, and which of them holds each open slot (-1: empty).
     */
    stand?: { roster: P[]; sorted: P[]; owner: Int32Array };
    /** The last stream's swap, so the standing lineup can follow it without a full solve. */
    swapped?: { from: P[]; to: P[]; gone: P; pick: P };
    /** This week's lineups for the roster as it stands (fitStreams). */
    week?: Week;
  };
  const setRoster = (x: TeamState, r: P[]) => {
    x.roster = r;
    x.lineups.clear();
  };
  /** Which roster players pass `keep`, as a bitmask over the roster. */
  const maskOf = (x: TeamState, keep: (r: P) => boolean) => {
    let mask = 0;
    for (let k = 0; k < x.roster.length; k++) if (keep(x.roster[k]!)) mask |= 1 << k;
    return mask;
  };
  const solve = (x: TeamState, mask: number) => {
    const l = bestLineup(x.roster.filter((_, k) => (mask >> k) & 1));
    x.lineups.set(mask, l);
    return l;
  };
  /** The best lineup from the roster players passing `keep` (memoized by who passes). */
  const lineupOf = (x: TeamState, keep: (r: P) => boolean) => {
    const mask = maskOf(x, keep);
    return x.lineups.get(mask) ?? solve(x, mask);
  };
  const fit = (r: P) => outOf(r) === 0;
  /** A streaming target's worth today: his games left this week plus a few games' value. */
  const val = (pl: P) => {
    const o = outOf(pl);
    return (o > 0 ? 0 : pl.fppg * pl.left[day]!) + 3 * pl.fppg * (o > 5 ? 0.3 : 1);
  };

  /**
   * Can he play his team's game on day `d` of this week, as far as is known today? His current
   * absence runs its course over his team's games before then.
   */
  const availOn = (pl: P, d: number) =>
    pl.days[d] === 1 && outOf(pl) <= pl.left[day]! - pl.left[d]!;
  /**
   * fitStreams (attempt 2's values, MODEL_CARD 2026-11-16; attempt 4's cost): worth in lineup
   * points, from the team's lineups on this week's remaining days. The lineups (everyone on the
   * roster who plays that day) are patched from the standing lineup once per team per week and
   * roster (`dayOf`), and the standing lineup follows each stream (`restand`); each
   * player's own availability counts his current absence. A roster player is worth what the
   * lineup loses without him (his points minus the best player not starting that day who fits
   * his slot); a free agent what he adds (his points in an open slot that takes him, else over
   * the weakest starter whose slot he fits). Plus `3 x fppg` scaled by the share of this week's
   * games he'd start (1 with none left).
   */
  /**
   * The standing lineup after one swap, from the one before it, exactly as `bestLineup` would
   * choose it (same order, ties by roster position): without `gone` the lineup keeps the other
   * starters and refills his slot from the bench if it can (as in `dayOf`); `pick` then takes a
   * slot by an augmenting path, or replaces the weakest starter whose removal lets him in, if
   * he's better.
   */
  const restand = (st: { sorted: P[]; owner: Int32Array }, roster: P[], gone: P, pick: P) => {
    const prev = st.sorted;
    const at = roster.indexOf(pick);
    const next: P[] = [];
    let pi = -1;
    for (const q of prev) {
      if (q === gone) continue;
      if (pi < 0 && (q.fppg < pick.fppg || (q.fppg === pick.fppg && roster.indexOf(q) > at))) {
        pi = next.length;
        next.push(pick);
      }
      next.push(q);
    }
    if (pi < 0) {
      pi = next.length;
      next.push(pick);
    }
    sorted = next;
    let seated = 0;
    let refill = false;
    for (let j = 0; j < OPEN.length; j++) {
      const o = st.owner[j]!;
      const q = o < 0 ? null : prev[o]!;
      if (q === gone) refill = true;
      owner[j] = !q || q === gone ? -1 : next.indexOf(q);
      if (owner[j]! >= 0) seated++;
    }
    let starter = 0;
    for (let j = 0; j < OPEN.length; j++) if (owner[j]! >= 0) starter |= 1 << owner[j]!;
    // Removing one starter frees at most one place: the best bench player who can reach it.
    if (refill)
      for (let i = 0; i < next.length; i++) {
        if ((starter >> i) & 1 || i === pi) continue;
        seen = 0;
        if (tryPlace(i)) {
          seated++;
          starter |= 1 << i;
          break;
        }
      }
    seen = 0;
    if (!(seated < OPEN.length && tryPlace(pi)))
      for (let i = next.length - 1; i > pi; i--) {
        if (!((starter >> i) & 1)) continue;
        snap.set(owner);
        owner[owner.indexOf(i)] = -1;
        seen = 0;
        if (tryPlace(pi)) break;
        owner.set(snap);
      }
    return { roster, sorted: next, owner: Int32Array.from(owner) };
  };
  const standOf = (x: TeamState) => {
    const st = x.stand;
    if (st?.roster === x.roster) return st;
    const sw = x.swapped;
    if (st && sw && sw.from === st.roster && sw.to === x.roster)
      x.stand = restand(st, x.roster, sw.gone, sw.pick);
    else {
      bestLineup(x.roster);
      x.stand = { roster: x.roster, sorted, owner: Int32Array.from(owner) };
    }
    return x.stand;
  };
  /**
   * Day `d`'s lineup from the standing one, exactly as a full solve would make it: the best
   * lineup from a subset keeps every standing starter in it (greedy on a matroid), so the
   * standing starters who play stay, and the others who play are added best first by the same
   * augmenting paths as `bestLineup`.
   */
  const dayOf = (st: { sorted: P[]; owner: Int32Array }, d: number, into: Day) => {
    sorted = st.sorted;
    owner.set(st.owner);
    let seated = 0;
    let starter = 0;
    for (let j = 0; j < OPEN.length; j++) {
      const o = owner[j]!;
      if (o < 0) continue;
      starter |= 1 << o;
      if (sorted[o]!.days[d] === 1) seated++;
      else owner[j] = -1;
    }
    const bench = into.bench;
    bench.length = 0;
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i]!;
      if ((starter >> i) & 1 || p.days[d] !== 1) continue;
      // A failed augmenting path leaves the slots as they were.
      seen = 0;
      if (seated < OPEN.length && tryPlace(i)) seated++;
      else bench.push(p);
    }
    into.d = d;
    for (let j = 0; j < OPEN.length; j++)
      into.slots[j] = owner[j]! >= 0 ? sorted[owner[j]!]! : null;
  };
  const weekOf = (x: TeamState): Week => {
    let w = x.week;
    if (w && w.period === period[day] && w.roster === x.roster) return w;
    // From today: the days before it are never read (the cache lasts while the roster does).
    // Each team's buffers are refilled in place.
    w ??= x.week = { period: -1, roster: x.roster, n: 0, days: [] };
    const st = standOf(x);
    let n = 0;
    for (let d = day; d <= lastDay && period[d] === period[day]; d++, n++)
      dayOf(st, d, (w.days[n] ??= { d, slots: new Array<P | null>(OPEN.length), bench: [] }));
    w.period = period[day]!;
    w.roster = x.roster;
    w.n = n;
    return w;
  };
  type Day = { d: number; slots: (P | null)[]; bench: P[] };
  /** A team's lineups on this week's days from the day it was built (the first `n` of `days`). */
  type Week = { period: number; roster: P[]; n: number; days: Day[] };
  /** The week's lineups for scoring; a cached week also holds earlier days, which it skips. */
  const fitOf = (x: TeamState): Week => weekOf(x);
  const later = (pl: P, plays: number, starts: number, o: number) =>
    3 * pl.fppg * (plays ? starts / plays : 1) * (o > 5 ? 0.3 : 1);
  const rosterVal = (week: Week, r: P) => {
    const o = outOf(r);
    const left = r.left[day]!;
    let pts = 0;
    let plays = 0;
    let starts = 0;
    for (let k = 0; k < week.n; k++) {
      const { d, slots, bench } = week.days[k]!;
      // Earlier days of a cached week, and days his absence still covers (as in `availOn`).
      if (d < day || r.days[d] !== 1 || o > left - r.left[d]!) continue;
      plays++;
      const j = slots.indexOf(r);
      if (j < 0) continue;
      starts++;
      let next = 0;
      for (const b of bench) if ((b.elig >> j) & 1 && b.fppg > next && availOn(b, d)) next = b.fppg;
      pts += r.fppg - next;
    }
    return pts + later(r, plays, starts, o);
  };
  const freeVal = (week: Week, f: P) => {
    const o = outOf(f);
    const left = f.left[day]!;
    let pts = 0;
    let plays = 0;
    let starts = 0;
    for (let k = 0; k < week.n; k++) {
      const { d, slots } = week.days[k]!;
      if (d < day || f.days[d] !== 1 || o > left - f.left[d]!) continue;
      plays++;
      let gain = 0;
      for (let j = 0; j < slots.length; j++) {
        if (!((f.elig >> j) & 1)) continue;
        const s = slots[j];
        gain = Math.max(gain, s ? f.fppg - s.fppg : f.fppg);
      }
      if (gain > 0) {
        starts++;
        pts += gain;
      }
    }
    return pts + later(f, plays, starts, o);
  };
  /** The `k` roster players with the lowest raw value (each valued once). */
  const weakF: P[] = [];
  const weakV: number[] = [];
  const weakest = (roster: P[], k: number) => {
    weakF.length = 0;
    weakV.length = 0;
    for (const r of roster) {
      const v = val(r);
      if (weakF.length === k && v >= weakV[k - 1]!) continue;
      let i = Math.min(weakF.length, k - 1);
      while (i > 0 && weakV[i - 1]! > v) {
        weakF[i] = weakF[i - 1]!;
        weakV[i] = weakV[i - 1]!;
        i--;
      }
      weakF[i] = r;
      weakV[i] = v;
    }
    return weakF;
  };
  /** The `k` unowned free agents with the highest `score` (best first). */
  const topF: P[] = [];
  const topV: number[] = [];
  const topFree = (list: P[], k: number, score: (f: P) => number) => {
    topF.length = 0;
    topV.length = 0;
    for (const f of list) {
      if (faOwner[f.h] !== -1) continue;
      const v = score(f);
      if (topF.length === k && v <= topV[k - 1]!) continue;
      // Insert in order (k is small): shift the lower ones down.
      let i = Math.min(topF.length, k - 1);
      while (i > 0 && topV[i - 1]! < v) {
        topF[i] = topF[i - 1]!;
        topV[i] = topV[i - 1]!;
        i--;
      }
      topF[i] = f;
      topV[i] = v;
    }
    return topF;
  };
  /**
   * Today's best free agents by raw value, best first: ranked once a day for every team's
   * stream check (values change only from day to day), with players released today inserted as
   * they come back. Exactly what `topFree(list, k, val)` returns; it rescans when too few of
   * the ranked ones are still free.
   */
  const SHORT = 16;
  const shortF: P[] = [];
  const shortV: number[] = [];
  let shortStamp = -1;
  /** Free agents were left out of the ranking (it was full). */
  let shortCut = false;
  const shortInsert = (f: P, v: number) => {
    if (shortF.length === SHORT) {
      shortCut = true;
      if (v <= shortV[SHORT - 1]!) return;
    }
    let i = Math.min(shortF.length, SHORT - 1);
    while (i > 0 && shortV[i - 1]! < v) {
      shortF[i] = shortF[i - 1]!;
      shortV[i] = shortV[i - 1]!;
      i--;
    }
    shortF[i] = f;
    shortV[i] = v;
  };
  const rankFree = (list: P[]) => {
    shortF.length = 0;
    shortV.length = 0;
    shortCut = false;
    for (const f of list) if (faOwner[f.h] === -1) shortInsert(f, val(f));
    shortStamp = stamp;
  };
  /** A player back in the pool today: ranked with the rest, at his value now (fitStreams). */
  const backInPool = (f: P) => {
    if (!fitStreams || shortStamp !== stamp) return;
    const i = shortF.indexOf(f);
    if (i >= 0) {
      shortF.splice(i, 1);
      shortV.splice(i, 1);
    }
    shortInsert(f, val(f));
  };
  const topFreeByVal = (list: P[], k: number) => {
    if (shortStamp !== stamp) rankFree(list);
    const take = () => {
      topF.length = 0;
      for (let i = 0; i < shortF.length && topF.length < k; i++)
        if (faOwner[shortF[i]!.h] === -1) topF.push(shortF[i]!);
    };
    take();
    if (topF.length < k && shortCut) {
      rankFree(list);
      take();
    }
    return topF;
  };

  let seasonsDone = 0;
  const summary = (): SimTeamResult[] => {
    const S = seasonsDone;
    return teams.map((t, i) => ({
      teamId: t.id,
      expWins: agg[i]!.wins / S,
      expPointsFor: agg[i]!.pf / S,
      playoffs: agg[i]!.po / S,
      seed1: agg[i]!.seed1 / S,
      bye: agg[i]!.bye / S,
      final: agg[i]!.final / S,
      champ: agg[i]!.champ / S,
      champBye: agg[i]!.champBye / S,
    }));
  };

  // Playoff replays start on the first playoff day, once the regular season is still to finish
  // or just finished (not when the simulation starts inside the playoffs).
  const REPLAYS = Math.max(1, Math.floor(input.playoffReplays ?? 1));
  const REPLAY_SALT = 0x51ed;
  let replayFrom = -1;
  if (REPLAYS > 1) {
    for (let d = fromDay; d <= lastDay; d++) {
      if (period[d] === input.playoffWeeks[0]) {
        replayFrom = d;
        break;
      }
    }
  }

  for (let s = 0; s < input.seasons; s++) {
    const seasonKey = mix(seed, s);
    for (let h = 0; h < NH; h++) playerKey[h] = mix(seasonKey, idOf[h]!);
    for (let i = 0; i < n; i++) teamKey[i] = mix(seasonKey, teams[i]!.id);
    ready.fill(0);
    readyCount = 0;
    faOwner.fill(-1);
    pending.forEach((pd, i) => {
      if (pd) faOwner[pd.add.h] = i;
    });
    /** Players a roster change (SimTeam.next) put in the pool: they keep healing there. */
    const released: P[] = [];

    const faList = [...inputFAs];
    const inFaList = new Set(faList);
    pointsAsOf(fromDay);
    const st = rosters.map((roster, i) => {
      // A player already in the IR slot comes back in place of the team's designated cut, or
      // else the roster's weakest player.
      const reserve = roster.find((r) => r.src.reserve);
      const active = roster.filter((r) => r !== reserve);
      let weakest: P | undefined = active.find((r) => r.src.id === teams[i]!.irCut);
      if (!weakest) for (const r of active) if (!weakest || r.fppg < weakest.fppg) weakest = r;
      return {
        roster: active,
        ir: reserve && weakest ? { player: reserve, fill: weakest } : null,
        standing: [] as P[],
        budget: 0,
        streamer: teams[i]!.addsPerWeek >= 0.25,
        /** Lineups by availability bitmask, for the roster as it stands. */
        lineups: new Map<number, P[]>(),
        swapped: undefined as TeamState["swapped"],
      };
    });
    const weekPts = banked.map((b) => Float64Array.from(b));
    adds.fill(0);
    for (const list of pickups) list.length = 0;
    let curP = 0;
    const orderKey = new Float64Array(n);
    const rosterIds = () =>
      st.map((x) => [...x.roster, ...(x.ir ? [x.ir.player] : [])].map((r) => r.src.id));

    const playDay = (d: number) => {
      // Points per game as of this day; a change re-solves every team's lineups (and the
      // standing lineup and week that fitStreams keeps, ordered by points).
      if (pointsAsOf(d))
        for (const x of st) {
          setRoster(x, x.roster);
          x.stand = x.swapped = undefined;
          if (x.week) x.week.period = -1;
        }
      const p = period[d]!;
      if (p !== curP) {
        curP = p;
        st.forEach((x, i) => {
          x.budget = Math.min(
            input.addCapPerWeek,
            poisson(teams[i]!.addsPerWeek, draw(teamKey[i]!, p, DRAW.adds)),
          );
        });
        for (let k = 0; k < readyCount; k++) {
          const h = readyList[k]!;
          form[h] = 0.8 * form[h]! + 0.6 * FORM * gauss(playerKey[h]!, p, DRAW.form);
        }
      }
      stamp++;
      day = d;
      pending.forEach((pd, i) => {
        if (!pd || pd.day !== d) return;
        const x = st[i]!;
        const nx = teams[i]!.next!;
        let gone: P | undefined;
        if (nx.drop != null) {
          gone = x.roster.find((r) => r.src.id === nx.drop);
          if (!gone) for (const r of x.roster) if (!gone || r.fppg < gone.fppg) gone = r;
        }
        const swapped = gone
          ? x.roster.map((r) => (r === gone ? pd.add : r))
          : [...x.roster, pd.add];
        setRoster(x, swapped);
        if (gone) {
          faOwner[gone.h] = -1;
          if (!inFaList.has(gone)) {
            faList.push(gone);
            inFaList.add(gone);
          }
          backInPool(gone);
          if (!released.includes(gone)) released.push(gone);
        }
        const cut = nx.irCut != null ? swapped.find((r) => r.src.id === nx.irCut) : undefined;
        if (x.ir && cut) x.ir = { ...x.ir, fill: cut };
      });
      for (const f of inputFAs) if (faOwner[f.h] === -1) isHealthy(f);
      for (const f of released) if (faOwner[f.h] === -1) isHealthy(f);
      // A player a team gets later keeps healing until he joins.
      pending.forEach((pd) => {
        if (pd && d < pd.day) isHealthy(pd.add);
      });
      // Players in the IR slot keep healing (their injury counts down on their team's games).
      for (const x of st) if (x.ir) isHealthy(x.ir.player);

      for (let i = 0; i < n; i++) orderKey[i] = draw(teamKey[i]!, d, DRAW.order);
      const order = [...Array(n).keys()].sort((a, b) => orderKey[a]! - orderKey[b]!);
      for (const ti of order) {
        const t = teams[ti]!;
        const x = st[ti]!;
        const checks = draw(teamKey[ti]!, d, DRAW.active) < t.act;
        if (checks) {
          if (x.ir && outOf(x.ir.player) === 0) {
            // Back from IR: the player who filled in goes; if he was already streamed away, the
            // roster's weakest player does (the roster never grows past its size).
            let fill: P | undefined = x.roster.includes(x.ir.fill) ? x.ir.fill : undefined;
            if (!fill) for (const r of x.roster) if (!fill || r.fppg < fill.fppg) fill = r;
            const back = x.ir.player;
            if (fill) {
              const gone = fill;
              setRoster(x, [...x.roster.filter((r) => r !== gone), back]);
              faOwner[gone.h] = -1;
              if (!inFaList.has(gone)) {
                faList.push(gone);
                inFaList.add(gone);
              }
              backInPool(gone);
            } else setRoster(x, [...x.roster, back]);
            x.ir = null;
          }
          if (!x.ir && x.budget > 0) {
            const hurt = x.roster.find((r) => outOf(r) > 5);
            let fa: P | undefined;
            if (hurt && fitStreams) {
              // The best fit among the few best by points.
              const fit = fitOf(x);
              let faV = -Infinity;
              for (const f of topFree(faList, FIT_CANDIDATES, (p) => p.fppg)) {
                const v = freeVal(fit, f);
                if (v > faV) {
                  fa = f;
                  faV = v;
                }
              }
            } else if (hurt)
              for (const f of faList) if (faOwner[f.h] === -1 && (!fa || f.fppg > fa.fppg)) fa = f;
            if (hurt && fa) {
              setRoster(x, [...x.roster.filter((r) => r !== hurt), fa]);
              faOwner[fa.h] = ti;
              x.ir = { player: hurt, fill: fa };
              x.budget--;
              adds[ti]!++;
              pickups[ti]!.push(fa.src.id);
            }
          }
          if (x.streamer && x.budget > 0) {
            const fit = fitStreams ? fitOf(x) : null;
            let drop: P | undefined;
            let dropV = Infinity;
            // Fit scores only the few weakest by raw value (cheap), like the free agents.
            const dropPool = fit ? weakest(x.roster, FIT_CANDIDATES) : x.roster;
            for (const r of dropPool) {
              const v = fit ? rosterVal(fit, r) : val(r);
              if (v < dropV) {
                drop = r;
                dropV = v;
              }
            }
            if (drop && (outOf(drop) <= 5 || x.ir)) {
              let best: P | null = null;
              let bestV = dropV + 8;
              for (const f of fit ? topFreeByVal(faList, FIT_CANDIDATES) : faList) {
                if (faOwner[f.h] !== -1) continue;
                // A healthy free agent's lineup value is at most his raw value: skip the hopeless.
                if (fit && outOf(f) === 0 && val(f) <= bestV) continue;
                const v = fit ? freeVal(fit, f) : val(f);
                if (v > bestV) {
                  best = f;
                  bestV = v;
                }
              }
              if (best) {
                const pick = best;
                const gone = drop;
                const from = x.roster;
                setRoster(
                  x,
                  x.roster.map((r) => (r === gone ? pick : r)),
                );
                if (fitStreams) x.swapped = { from, to: x.roster, gone, pick };
                faOwner[gone.h] = -1;
                if (!inFaList.has(gone)) {
                  faList.push(gone);
                  inFaList.add(gone);
                }
                backInPool(gone);
                faOwner[pick.h] = ti;
                x.budget--;
                adds[ti]!++;
                pickups[ti]!.push(pick.src.id);
              }
            }
          }
          x.standing = lineupOf(x, fit);
        }
        let lineup: P[];
        if (checks) lineup = lineupOf(x, isHealthy);
        else {
          const avail = new Set(x.roster.filter(isHealthy));
          lineup = x.standing.filter((r) => avail.has(r));
        }
        const pts = weekPts[ti]!;
        for (const r of lineup) {
          const h = r.h;
          pts[p] =
            pts[p]! +
            Math.max(
              -5,
              r.fppg *
                mult[h]! *
                Math.max(0.3, 1 + form[h]!) *
                (1 + NOISE * gauss(playerKey[h]!, d, DRAW.game)),
            );
        }
      }
    };

    // The regular season, then the playoffs (replayed from the same end of the regular season
    // when asked: input.playoffReplays).
    const regularEnd = replayFrom >= fromDay ? replayFrom - 1 : lastDay;
    for (let d = fromDay; d <= regularEnd; d++) playDay(d);
    const regularAdds = Array.from(adds);
    const regularPickups = pickups.map((list) => [...list]);
    // Regular season: decided weeks keep their actual winner.
    const wins = new Array<number>(n).fill(0);
    const pf = new Array<number>(n).fill(0);
    for (const m of input.matchups) {
      if (m.period > input.regularWeeks) continue;
      const hi = tIndex.get(m.home);
      const ai = tIndex.get(m.away);
      if (hi == null || ai == null) continue;
      const hp = weekPts[hi]![m.period]!;
      const ap = weekPts[ai]![m.period]!;
      pf[hi] = pf[hi]! + hp;
      pf[ai] = pf[ai]! + ap;
      const winner = m.winner ?? (hp > ap ? "HOME" : hp < ap ? "AWAY" : "TIE");
      if (winner === "HOME") wins[hi] = wins[hi]! + 1;
      else if (winner === "AWAY") wins[ai] = wins[ai]! + 1;
      else {
        wins[hi] = wins[hi]! + 0.5;
        wins[ai] = wins[ai]! + 0.5;
      }
    }
    pf.forEach((v, i) => {
      agg[i]!.wins += wins[i]!;
      agg[i]!.pf += v;
    });
    const seeds = [...Array(n).keys()]
      .sort((a, b) => wins[b]! - wins[a]! || pf[b]! - pf[a]!)
      .slice(0, 6);
    seeds.forEach((i) => agg[i]!.po++);
    agg[seeds[0]!]!.seed1++;
    const [qw, sw, fw] = input.playoffWeeks;
    const bracket = () => {
      const winnerOf = (a: number, b: number, w: number) =>
        weekPts[a]![w]! >= weekPts[b]![w]! ? a : b;
      const q1 = winnerOf(seeds[2]!, seeds[5]!, qw);
      const q2 = winnerOf(seeds[3]!, seeds[4]!, qw);
      const s1 = winnerOf(seeds[0]!, q2, sw);
      const s2 = winnerOf(seeds[1]!, q1, sw);
      return { s1, s2, champion: winnerOf(s1, s2, fw) };
    };
    const shares = new Float64Array(n);
    let firstChampion = -1;
    let endRosters: number[][] = [];
    if (replayFrom < fromDay) {
      const b = bracket();
      agg[b.s1]!.final++;
      agg[b.s2]!.final++;
      agg[b.champion]!.champ++;
      shares[b.champion] = 1;
      firstChampion = b.champion;
      endRosters = rosterIds();
    } else {
      // Where the regular season ended: every replay starts from here.
      const saved = {
        ready: ready.slice(),
        readyList: readyList.slice(),
        readyCount,
        mult: mult.slice(),
        form: form.slice(),
        q: q.slice(),
        out: out.slice(),
        loadMgd: loadMgd.slice(),
        faOwner: faOwner.slice(),
        faList: [...faList],
        st: st.map((x) => ({ ...x })),
        weekPts: weekPts.map((w) => w.slice()),
        curP,
      };
      for (let r = 0; r < REPLAYS; r++) {
        if (r > 0) {
          ready.set(saved.ready);
          readyList.set(saved.readyList);
          readyCount = saved.readyCount;
          mult.set(saved.mult);
          form.set(saved.form);
          q.set(saved.q);
          out.set(saved.out);
          loadMgd.set(saved.loadMgd);
          faOwner.set(saved.faOwner);
          faList.length = 0;
          faList.push(...saved.faList);
          inFaList.clear();
          for (const f of faList) inFaList.add(f);
          // Fresh lineup caches: a replay's roster changes refilled the shared ones.
          st.forEach((x, i) =>
            Object.assign(x, saved.st[i], {
              lineups: new Map(),
              stand: undefined,
              swapped: undefined,
              week: undefined,
            }),
          );
          weekPts.forEach((w, i) => w.set(saved.weekPts[i]!));
          curP = saved.curP;
          // New luck for this replay: every draw from here on is keyed by it.
          const replayKey = mix(seasonKey, REPLAY_SALT + r);
          for (let h = 0; h < NH; h++) playerKey[h] = mix(replayKey, idOf[h]!);
          for (let i = 0; i < n; i++) teamKey[i] = mix(replayKey, teams[i]!.id);
        }
        for (let d = replayFrom; d <= lastDay; d++) playDay(d);
        const b = bracket();
        agg[b.s1]!.final += 1 / REPLAYS;
        agg[b.s2]!.final += 1 / REPLAYS;
        agg[b.champion]!.champ += 1 / REPLAYS;
        shares[b.champion] = shares[b.champion]! + 1 / REPLAYS;
        if (r === 0) {
          firstChampion = b.champion;
          endRosters = rosterIds();
        }
      }
    }
    for (const i of seeds.slice(0, 2)) {
      agg[i]!.bye++;
      agg[i]!.champBye += shares[i]!;
    }
    input.inspect?.(s, {
      rosters: endRosters,
      wins,
      champion: teams[firstChampion]!.id,
      seed1: teams[seeds[0]!]!.id,
      playoffs: seeds.map((i) => teams[i]!.id),
      titleShares: Array.from(shares),
      points: weekPts.map((w) => Array.from(w)),
      adds: regularAdds,
      pickups: regularPickups,
    });
    seasonsDone++;
    yield summary;
  }
  return summary();
}
