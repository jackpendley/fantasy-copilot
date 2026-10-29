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
}

export interface SimTeam {
  id: number;
  roster: SimPlayer[];
  /** Share of days the manager sets an optimal lineup (1 = daily). */
  act: number;
  /** Average waiver adds per week. */
  addsPerWeek: number;
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
}

export interface SimTeamResult {
  teamId: number;
  expWins: number;
  expPointsFor: number;
  playoffs: number;
  seed1: number;
  final: number;
  champ: number;
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
    }
    return x;
  };
  const teams = input.teams;
  const n = teams.length;
  const rosters = teams.map((t) => t.roster.map(wrap));
  const inputFAs = input.freeAgents.map(wrap);
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

  const tIndex = new Map(teams.map((t, i) => [t.id, i]));
  const lastPeriod = input.periodOf(lastDay);
  const agg = teams.map(() => ({ wins: 0, pf: 0, po: 0, seed1: 0, final: 0, champ: 0 }));

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

  type TeamState = { roster: P[]; lineups: Map<number, P[]> };
  const setRoster = (x: TeamState, r: P[]) => {
    x.roster = r;
    x.lineups.clear();
  };
  /** The best lineup from the roster players passing `keep` (memoized by who passes). */
  const lineupOf = (x: TeamState, keep: (r: P) => boolean) => {
    let mask = 0;
    const pass: P[] = [];
    for (let k = 0; k < x.roster.length; k++) {
      const r = x.roster[k]!;
      if (keep(r)) {
        mask |= 1 << k;
        pass.push(r);
      }
    }
    let l = x.lineups.get(mask);
    if (!l) {
      l = bestLineup(pass);
      x.lineups.set(mask, l);
    }
    return l;
  };
  const fit = (r: P) => outOf(r) === 0;
  /** A streaming target's worth today: his games left this week plus a few games' value. */
  const val = (pl: P) => {
    const o = outOf(pl);
    return (o > 0 ? 0 : pl.fppg * pl.left[day]!) + 3 * pl.fppg * (o > 5 ? 0.3 : 1);
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
      final: agg[i]!.final / S,
      champ: agg[i]!.champ / S,
    }));
  };

  for (let s = 0; s < input.seasons; s++) {
    const seasonKey = mix(seed, s);
    for (let h = 0; h < NH; h++) playerKey[h] = mix(seasonKey, idOf[h]!);
    for (let i = 0; i < n; i++) teamKey[i] = mix(seasonKey, teams[i]!.id);
    ready.fill(0);
    readyCount = 0;
    faOwner.fill(-1);

    const faList = [...inputFAs];
    const inFaList = new Set(faList);
    const st = rosters.map((roster, i) => {
      // A player already in the IR slot comes back in place of the roster's weakest player.
      const reserve = roster.find((r) => r.src.reserve);
      const active = roster.filter((r) => r !== reserve);
      let weakest: P | undefined;
      for (const r of active) if (!weakest || r.fppg < weakest.fppg) weakest = r;
      return {
        roster: active,
        ir: reserve && weakest ? { player: reserve, fill: weakest } : null,
        standing: [] as P[],
        budget: 0,
        streamer: teams[i]!.addsPerWeek >= 0.25,
        /** Lineups by availability bitmask, for the roster as it stands. */
        lineups: new Map<number, P[]>(),
      };
    });
    const weekPts = banked.map((b) => Float64Array.from(b));
    let curP = 0;
    const orderKey = new Float64Array(n);

    for (let d = fromDay; d <= lastDay; d++) {
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
      for (const f of inputFAs) if (faOwner[f.h] === -1) isHealthy(f);
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
            } else setRoster(x, [...x.roster, back]);
            x.ir = null;
          }
          if (!x.ir && x.budget > 0) {
            const hurt = x.roster.find((r) => outOf(r) > 5);
            let fa: P | undefined;
            if (hurt)
              for (const f of faList) if (faOwner[f.h] === -1 && (!fa || f.fppg > fa.fppg)) fa = f;
            if (hurt && fa) {
              setRoster(x, [...x.roster.filter((r) => r !== hurt), fa]);
              faOwner[fa.h] = ti;
              x.ir = { player: hurt, fill: fa };
              x.budget--;
            }
          }
          if (x.streamer && x.budget > 0) {
            let drop: P | undefined;
            let dropV = Infinity;
            for (const r of x.roster) {
              const v = val(r);
              if (v < dropV) {
                drop = r;
                dropV = v;
              }
            }
            if (drop && (outOf(drop) <= 5 || x.ir)) {
              let best: P | null = null;
              let bestV = dropV + 8;
              for (const f of faList) {
                if (faOwner[f.h] !== -1) continue;
                const v = val(f);
                if (v > bestV) {
                  best = f;
                  bestV = v;
                }
              }
              if (best) {
                const pick = best;
                const gone = drop;
                setRoster(
                  x,
                  x.roster.map((r) => (r === gone ? pick : r)),
                );
                faOwner[gone.h] = -1;
                if (!inFaList.has(gone)) {
                  faList.push(gone);
                  inFaList.add(gone);
                }
                faOwner[pick.h] = ti;
                x.budget--;
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
    }
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
    const winnerOf = (a: number, b: number, w: number) =>
      weekPts[a]![w]! >= weekPts[b]![w]! ? a : b;
    const q1 = winnerOf(seeds[2]!, seeds[5]!, qw);
    const q2 = winnerOf(seeds[3]!, seeds[4]!, qw);
    const s1 = winnerOf(seeds[0]!, q2, sw);
    const s2 = winnerOf(seeds[1]!, q1, sw);
    agg[s1]!.final++;
    agg[s2]!.final++;
    const champion = winnerOf(s1, s2, fw);
    agg[champion]!.champ++;
    input.inspect?.(s, {
      rosters: st.map((x) => [...x.roster, ...(x.ir ? [x.ir.player] : [])].map((r) => r.src.id)),
      wins,
      champion: teams[champion]!.id,
      seed1: teams[seeds[0]!]!.id,
      playoffs: seeds.map((i) => teams[i]!.id),
    });
    seasonsDone++;
    yield summary;
  }
  return summary();
}
