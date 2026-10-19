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

import { isStartingSlot, slotAccepts, expandSlots, type Position } from "./slots";

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
  /** Per-game noise and weekly form sd (calibrated defaults). */
  noise?: number;
  form?: number;
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

export function simulateSeason(input: SimInput): SimTeamResult[] {
  const NOISE = input.noise ?? 0.5;
  const FORM = input.form ?? 0.28;
  const OPEN = expandSlots(input.slotCounts).filter(isStartingSlot);
  let seed = (input.seed ?? 20261018) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const poisson = (lam: number) => {
    let k = 0;
    let p = Math.exp(-lam);
    let s = p;
    const u = rnd();
    while (u > s && k < 10) {
      k++;
      p *= lam / k;
      s += p;
    }
    return k;
  };
  const geom = (mean: number) => 1 + Math.floor(Math.log(1 - rnd()) / Math.log(1 - 1 / mean));

  // Greedy by value is optimal on this slot structure (transversal matroid).
  function bestLineup(players: SimPlayer[]): SimPlayer[] {
    const owner = new Array<number>(OPEN.length).fill(-1);
    const sorted = [...players].sort((a, b) => b.fppg - a.fppg);
    const seated: SimPlayer[] = [];
    const tryPlace = (pi: number, seen: boolean[]): boolean => {
      for (let s = 0; s < OPEN.length; s++) {
        if (seen[s] || !slotAccepts(OPEN[s]!, sorted[pi]!.eligible)) continue;
        seen[s] = true;
        if (owner[s] === -1 || tryPlace(owner[s]!, seen)) {
          owner[s] = pi;
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < sorted.length && seated.length < OPEN.length; i++) {
      const snap = [...owner];
      if (tryPlace(i, new Array<boolean>(OPEN.length).fill(false))) seated.push(sorted[i]!);
      else owner.splice(0, owner.length, ...snap);
    }
    return seated;
  }

  const teams = input.teams;
  const n = teams.length;
  const tIndex = new Map(teams.map((t, i) => [t.id, i]));
  const plays = (pro: number, d: number) => input.gameDays.get(pro)?.has(d) ?? false;
  const b2b = (pro: number, d: number) => plays(pro, d) && plays(pro, d - 1);
  const lastPeriod = input.periodOf(input.lastDay);
  const agg = teams.map(() => ({ wins: 0, pf: 0, po: 0, seed1: 0, final: 0, champ: 0 }));

  // Points already banked, per team per period.
  const banked = teams.map((t) => {
    const arr = new Array<number>(lastPeriod + 1).fill(0);
    for (const [p, v] of input.banked.get(t.id) ?? []) if (p <= lastPeriod) arr[p] = v;
    return arr;
  });

  interface Health {
    mult: number;
    form: number;
    q: number;
    out: number;
    loadMgd: boolean;
  }

  for (let s = 0; s < input.seasons; s++) {
    const health = new Map<number, Health>();
    const H = (p: SimPlayer): Health => {
      let h = health.get(p.id);
      if (!h) {
        const miss = Math.min(0.85, Math.max(0.01, 1 - p.gp / 82));
        const spell = 0.75 * 2 + 0.25 * 15;
        h = {
          mult: Math.max(0.5, 1 + p.sd * gauss()),
          form: 0,
          q: miss / (spell * (1 - miss)),
          out: 0,
          loadMgd: p.gp < 72,
        };
        if (rnd() < miss) h.out = rnd() < 0.75 ? geom(2) : geom(15);
        health.set(p.id, h);
      }
      return h;
    };
    const healthyToday = (p: SimPlayer, d: number) => {
      const h = H(p);
      if (h.out > 0) {
        h.out--;
        return false;
      }
      const bump = h.loadMgd ? (b2b(p.proTeamId, d) ? 2 / 1.17 : 1 / 1.17) : 1;
      if (rnd() < h.q * bump) {
        h.out = (rnd() < 0.75 ? geom(2) : geom(15)) - 1;
        return false;
      }
      return true;
    };

    const faOwner = new Map<number, number>();
    const freeAgents = [...input.freeAgents];
    const st = teams.map((t) => ({
      roster: [...t.roster],
      ir: null as { player: SimPlayer; fill: SimPlayer } | null,
      standing: [] as SimPlayer[],
      budget: 0,
      streamer: t.addsPerWeek >= 0.25,
    }));
    const weekPts = banked.map((b) => [...b]);
    let curP = 0;

    for (let d = input.fromDay; d <= input.lastDay; d++) {
      const p = input.periodOf(d);
      if (p !== curP) {
        curP = p;
        st.forEach((x, i) => {
          x.budget = Math.min(input.addCapPerWeek, poisson(teams[i]!.addsPerWeek));
        });
        for (const h of health.values()) h.form = 0.8 * h.form + 0.6 * FORM * gauss();
      }
      const healthy = new Map<number, boolean>();
      const isHealthy = (pl: SimPlayer) => {
        if (!plays(pl.proTeamId, d)) return false;
        if (!healthy.has(pl.id)) healthy.set(pl.id, healthyToday(pl, d));
        return healthy.get(pl.id)!;
      };
      for (const f of input.freeAgents) if (!faOwner.has(f.id)) isHealthy(f);
      const remainingGames = (pl: SimPlayer) => {
        let g = 0;
        for (let k = d; k <= input.lastDay && input.periodOf(k) === p; k++)
          if (plays(pl.proTeamId, k)) g++;
        return g;
      };

      const order = [...Array(n).keys()].sort(() => rnd() - 0.5);
      for (const ti of order) {
        const t = teams[ti]!;
        const x = st[ti]!;
        const checks = rnd() < t.act;
        if (checks) {
          if (x.ir && H(x.ir.player).out === 0) {
            const fill = x.ir.fill;
            x.roster = x.roster.filter((r) => r !== fill);
            faOwner.delete(fill.id);
            freeAgents.push(fill);
            x.roster.push(x.ir.player);
            x.ir = null;
          }
          if (!x.ir && x.budget > 0) {
            const hurt = x.roster.find((r) => H(r).out > 5);
            const fa =
              hurt &&
              freeAgents.filter((f) => !faOwner.has(f.id)).sort((a, b) => b.fppg - a.fppg)[0];
            if (hurt && fa) {
              x.roster = x.roster.filter((r) => r !== hurt);
              x.roster.push(fa);
              faOwner.set(fa.id, ti);
              x.ir = { player: hurt, fill: fa };
              x.budget--;
            }
          }
          if (x.streamer && x.budget > 0) {
            const val = (pl: SimPlayer) =>
              (H(pl).out > 0 ? 0 : pl.fppg * remainingGames(pl)) +
              3 * pl.fppg * (H(pl).out > 5 ? 0.3 : 1);
            const out = [...x.roster].sort((a, b) => val(a) - val(b))[0];
            if (out && (H(out).out <= 5 || x.ir)) {
              let best: SimPlayer | null = null;
              let bestV = val(out) + 8;
              for (const f of freeAgents) {
                if (faOwner.has(f.id)) continue;
                const v = val(f);
                if (v > bestV) {
                  best = f;
                  bestV = v;
                }
              }
              if (best) {
                const pick = best;
                x.roster = x.roster.map((r) => (r === out ? pick : r));
                faOwner.delete(out.id);
                if (!freeAgents.includes(out)) freeAgents.push(out);
                faOwner.set(pick.id, ti);
                x.budget--;
              }
            }
          }
          x.standing = bestLineup(x.roster.filter((r) => H(r).out === 0));
        }
        const avail = x.roster.filter(isHealthy);
        const lineup = checks ? bestLineup(avail) : x.standing.filter((r) => avail.includes(r));
        for (const r of lineup) {
          const h = H(r);
          weekPts[ti]![p] =
            weekPts[ti]![p]! +
            Math.max(-5, r.fppg * h.mult * Math.max(0.3, 1 + h.form) * (1 + NOISE * gauss()));
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
    agg[winnerOf(s1, s2, fw)]!.champ++;
  }

  const S = input.seasons;
  return teams.map((t, i) => ({
    teamId: t.id,
    expWins: agg[i]!.wins / S,
    expPointsFor: agg[i]!.pf / S,
    playoffs: agg[i]!.po / S,
    seed1: agg[i]!.seed1 / S,
    final: agg[i]!.final / S,
    champ: agg[i]!.champ / S,
  }));
}
